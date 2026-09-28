import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account status on users and moderation status on items.
 *
 * Idempotent: a database once run with `synchronize` (any NODE_ENV other
 * than production) already has these types, columns and indexes from the
 * entities, without this migration recorded. Every step is skipped if it is
 * already there, so the migration can be recorded on such a database too.
 */
export class AddAccountAndListingModeration1794000000000 implements MigrationInterface {
  name = 'AddAccountAndListingModeration1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type
          WHERE typname = 'users_account_status_enum'
            AND typnamespace = 'public'::regnamespace
        ) THEN
          CREATE TYPE "public"."users_account_status_enum" AS ENUM('active', 'suspended', 'banned');
        END IF;
      END $$
    `);
    await queryRunner.query(
      `ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "account_status" "public"."users_account_status_enum" NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "status_reason" text,
        ADD COLUMN IF NOT EXISTS "suspended_until" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "status_changed_by" uuid,
        ADD COLUMN IF NOT EXISTS "status_changed_at" TIMESTAMP`,
    );
    // is_active=false meant one of two things before this: suspended from a
    // report, or a password sign-up that hasn't verified its email yet. The
    // second stays 'active' (it becomes usable on verification), so only
    // accounts that had verified something, or signed in through Firebase,
    // are taken to be suspended. Only rows still at the default are touched,
    // so on a database that already had the column a banned account is not
    // turned back into a suspended one.
    await queryRunner.query(
      `UPDATE "users" SET "account_status" = 'suspended'
        WHERE "is_active" = false AND "is_deleted" = false
          AND "account_status" = 'active'
          AND ("is_email_verified" = true OR "is_phone_verified" = true OR "firebase_uid" IS NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_users_account_status" ON "users" ("account_status", "suspended_until")`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type
          WHERE typname = 'items_moderation_status_enum'
            AND typnamespace = 'public'::regnamespace
        ) THEN
          CREATE TYPE "public"."items_moderation_status_enum" AS ENUM('visible', 'hidden', 'flagged');
        END IF;
      END $$
    `);
    await queryRunner.query(
      `ALTER TABLE "items"
        ADD COLUMN IF NOT EXISTS "moderation_status" "public"."items_moderation_status_enum" NOT NULL DEFAULT 'visible',
        ADD COLUMN IF NOT EXISTS "moderation_reason" text,
        ADD COLUMN IF NOT EXISTS "moderated_by" uuid,
        ADD COLUMN IF NOT EXISTS "moderated_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_items_moderation_status" ON "items" ("moderation_status", "is_deleted")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_items_moderation_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "items"
        DROP COLUMN "moderated_at",
        DROP COLUMN "moderated_by",
        DROP COLUMN "moderation_reason",
        DROP COLUMN "moderation_status"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."items_moderation_status_enum"`,
    );

    await queryRunner.query(`DROP INDEX "public"."idx_users_account_status"`);
    await queryRunner.query(
      `ALTER TABLE "users"
        DROP COLUMN "status_changed_at",
        DROP COLUMN "status_changed_by",
        DROP COLUMN "suspended_until",
        DROP COLUMN "status_reason",
        DROP COLUMN "account_status"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_account_status_enum"`);
  }
}
