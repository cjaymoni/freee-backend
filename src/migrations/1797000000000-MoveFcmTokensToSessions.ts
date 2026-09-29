import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Push tokens now live on the login session, one per signed-in device,
 * instead of in the single users.fcm_token.
 *
 * Each user's existing token is copied onto their most recent live session,
 * so installs that registered before this keep getting pushes until the app
 * registers again. It is skipped where a session already holds that token.
 * users.fcm_token is left in place, unused.
 *
 * The partial index serves the lookups by token: forgetting a dead one, and
 * taking a token off the session that held it before.
 */
export class MoveFcmTokensToSessions1797000000000 implements MigrationInterface {
  name = 'MoveFcmTokensToSessions1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE user_sessions s
      SET fcm_token = u.fcm_token
      FROM users u,
        (
          SELECT DISTINCT ON (user_id) id
          FROM user_sessions
          WHERE is_active = true
            AND COALESCE(refresh_token_expires_at, expires_at) > now()
          ORDER BY user_id, last_activity DESC
        ) latest
      WHERE s.id = latest.id
        AND u.id = s.user_id
        AND u.fcm_token IS NOT NULL
        AND s.fcm_token IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_sessions o WHERE o.fcm_token = u.fcm_token
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_sessions_fcm_token"
      ON user_sessions (fcm_token)
      WHERE fcm_token IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The copied tokens stay on their sessions: users.fcm_token still holds
    // the originals, so there is nothing to restore.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_sessions_fcm_token"`,
    );
  }
}
