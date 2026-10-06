import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks the people who listed items through the pre-launch Founding Freers
 * form, so the app can show them a badge.
 */
export class AddFoundingFreers1799000000000 implements MigrationInterface {
  name = 'AddFoundingFreers1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "is_founding_freer" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "founding_freer_since" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "founding_freer_since",
        DROP COLUMN IF EXISTS "is_founding_freer"
    `);
  }
}
