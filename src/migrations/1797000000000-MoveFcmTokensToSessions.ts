import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Push tokens now live on the login session, one per signed-in device,
 * instead of in the single users.fcm_token.
 *
 * Each user's existing token is copied onto their most recent session that
 * has not ended, so installs that registered before this keep getting pushes
 * until the app registers again. A token already on a session is left
 * there, and a token two users shared (one phone, two accounts) goes only to
 * the most recent of their sessions. users.fcm_token is left in place, unused.
 *
 * The partial index serves the lookups by token: forgetting a dead one, and
 * taking a token off the session that held it before.
 */
export class MoveFcmTokensToSessions1797000000000 implements MigrationInterface {
  name = 'MoveFcmTokensToSessions1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE user_sessions s
      SET fcm_token = pick.fcm_token
      FROM (
        -- One session per token: the newest among each user's latest.
        SELECT DISTINCT ON (u.fcm_token) latest.id, u.fcm_token
        FROM users u
        JOIN (
          SELECT DISTINCT ON (user_id) id, user_id, created_at
          FROM user_sessions
          WHERE is_active = true
          ORDER BY user_id, created_at DESC
        ) latest ON latest.user_id = u.id
        WHERE u.fcm_token IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_sessions o WHERE o.fcm_token = u.fcm_token
          )
        ORDER BY u.fcm_token, latest.created_at DESC
      ) pick
      WHERE s.id = pick.id AND s.fcm_token IS NULL
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
