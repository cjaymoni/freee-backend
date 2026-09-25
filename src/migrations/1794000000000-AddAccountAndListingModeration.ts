import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountAndListingModeration1794000000000 implements MigrationInterface {
  name = 'AddAccountAndListingModeration1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_account_status_enum" AS ENUM('active', 'suspended', 'banned')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users"
        ADD "account_status" "public"."users_account_status_enum" NOT NULL DEFAULT 'active',
        ADD "status_reason" text,
        ADD "suspended_until" TIMESTAMP,
        ADD "status_changed_by" uuid,
        ADD "status_changed_at" TIMESTAMP`,
    );
    // Accounts deactivated before this existed were suspended from a report.
    await queryRunner.query(
      `UPDATE "users" SET "account_status" = 'suspended' WHERE "is_active" = false AND "is_deleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_account_status" ON "users" ("account_status", "suspended_until")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."items_moderation_status_enum" AS ENUM('visible', 'hidden', 'flagged')`,
    );
    await queryRunner.query(
      `ALTER TABLE "items"
        ADD "moderation_status" "public"."items_moderation_status_enum" NOT NULL DEFAULT 'visible',
        ADD "moderation_reason" text,
        ADD "moderated_by" uuid,
        ADD "moderated_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_items_moderation_status" ON "items" ("moderation_status", "is_deleted")`,
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
