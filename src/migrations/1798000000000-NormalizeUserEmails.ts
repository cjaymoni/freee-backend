import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emails are now stored trimmed and lowercased (see src/common/email.ts), so
 * `Ama@Gmail.com` and the `ama@gmail.com` a Google sign-in carries reach the
 * same account. This brings existing rows into that form.
 *
 * Two accounts whose emails differ only in case are the same person with
 * two accounts. Picking one to keep is a merge, not a rename, so the
 * migration stops and lists them rather than guess; resolve them by hand
 * (clear the email on the account to give up) and run it again.
 *
 * The unique index on lower(email) backs this up, so a write that skips
 * normalization fails instead of creating a duplicate. Verification codes
 * are looked up by email too, so theirs are lowercased as well.
 *
 * Production runs migrations on boot, so a clash stops the release from
 * starting. Run the clash query from src/migrations/README.md against the
 * database before deploying. Development databases are synchronised from the
 * entities instead, and TypeORM can't express this index there: run
 * `npm run migration:run` on them too.
 *
 * Not CONCURRENTLY: migrations run in a transaction. Writes to users wait
 * while the index builds, which is brief unless the table is large; check
 * its size before deploying if it has grown.
 */
export class NormalizeUserEmails1798000000000 implements MigrationInterface {
  name = 'NormalizeUserEmails1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const clashes = (await queryRunner.query(`
      SELECT lower(trim(email)) AS email, array_agg(id::text) AS ids
      FROM users
      WHERE email IS NOT NULL
      GROUP BY lower(trim(email))
      HAVING count(*) > 1
    `)) as { email: string; ids: string[] }[];
    if (clashes.length) {
      const list = clashes
        .map((c) => `${c.email}: ${c.ids.join(', ')}`)
        .join('; ');
      throw new Error(
        `Accounts share an email apart from letter case; resolve them first: ${list}`,
      );
    }

    await queryRunner.query(`
      UPDATE users SET email = lower(trim(email))
      WHERE email IS NOT NULL AND email <> lower(trim(email))
    `);
    await queryRunner.query(`
      UPDATE verification_codes SET email = lower(trim(email))
      WHERE email IS NOT NULL AND email <> lower(trim(email))
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_email_lower"
      ON users (lower(email))
      WHERE email IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The original casing isn't kept, so only the index can be undone.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_email_lower"`);
  }
}
