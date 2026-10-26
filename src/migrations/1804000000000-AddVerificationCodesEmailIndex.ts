import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index for the email-code limits (src/auth/email): every send and check
 * counts an email's codes over the last hour or day. Without it each one
 * scans every code of that type.
 *
 * IF NOT EXISTS because a database synchronised from the entities already
 * has it under this name. Not CONCURRENTLY: migrations run in a
 * transaction at boot, and verification_codes is small.
 */
export class AddVerificationCodesEmailIndex1804000000000 implements MigrationInterface {
  name = 'AddVerificationCodesEmailIndex1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_verification_codes_email_type_created"
      ON verification_codes (email, code_type, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_verification_codes_email_type_created"`,
    );
  }
}
