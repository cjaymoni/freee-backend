import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateModerationTables1767900000000 implements MigrationInterface {
  name = 'CreateModerationTables1767900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reported_items" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "item_id" uuid NOT NULL,
        "reporter_id" uuid NOT NULL,
        "reason" varchar(100) NOT NULL,
        "description" text,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "priority" varchar(20) NOT NULL DEFAULT 'medium',
        "reviewed_by" uuid,
        "reviewed_at" timestamp,
        "resolution_notes" text,
        "action_taken" varchar(100),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "resolved_at" timestamp,
        CONSTRAINT "fk_reported_items_item" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reported_items_reporter" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reported_items_reviewer" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_reported_items_item_id" ON "reported_items" ("item_id")`);
    await queryRunner.query(`CREATE INDEX "idx_reported_items_reporter_id" ON "reported_items" ("reporter_id")`);
    await queryRunner.query(`CREATE INDEX "idx_reported_items_status" ON "reported_items" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_reported_items_priority" ON "reported_items" ("priority")`);
    await queryRunner.query(`CREATE INDEX "idx_reports_queue" ON "reported_items" ("status", "priority", "created_at")`);

    await queryRunner.query(`
      CREATE TABLE "reported_users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "reported_user_id" uuid NOT NULL,
        "reporter_id" uuid NOT NULL,
        "reason" varchar(100) NOT NULL,
        "description" text,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "priority" varchar(20) NOT NULL DEFAULT 'medium',
        "reviewed_by" uuid,
        "reviewed_at" timestamp,
        "resolution_notes" text,
        "action_taken" varchar(100),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "resolved_at" timestamp,
        CONSTRAINT "fk_reported_users_reported" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reported_users_reporter" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reported_users_reviewer" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_reported_users_reported_user_id" ON "reported_users" ("reported_user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_reported_users_reporter_id" ON "reported_users" ("reporter_id")`);
    await queryRunner.query(`CREATE INDEX "idx_reported_users_status" ON "reported_users" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_reported_users_queue" ON "reported_users" ("status", "priority", "created_at")`);

    await queryRunner.query(`
      CREATE TABLE "blocked_users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "blocker_id" uuid NOT NULL,
        "blocked_id" uuid NOT NULL,
        "reason" text,
        "is_deleted" boolean NOT NULL DEFAULT false,
        "deleted_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_blocked_users_blocker" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_blocked_users_blocked" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_blocked_users_blocker_id" ON "blocked_users" ("blocker_id")`);
    await queryRunner.query(`CREATE INDEX "idx_blocked_users_blocked_id" ON "blocked_users" ("blocked_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_blocked_users_unique" ON "blocked_users" ("blocker_id", "blocked_id", "is_deleted")`);

    await queryRunner.query(`
      CREATE TABLE "moderation_complaints" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "complaint_type" varchar(20) NOT NULL,
        "reference_id" uuid,
        "subject" varchar(100) NOT NULL,
        "description" text NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "reviewed_by" uuid,
        "reviewed_at" timestamp,
        "admin_response" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "resolved_at" timestamp,
        CONSTRAINT "fk_complaints_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_complaints_reviewer" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_complaints_user_id" ON "moderation_complaints" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_complaints_status" ON "moderation_complaints" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_complaints_created_at" ON "moderation_complaints" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "moderation_complaints"`);
    await queryRunner.query(`DROP TABLE "blocked_users"`);
    await queryRunner.query(`DROP TABLE "reported_users"`);
    await queryRunner.query(`DROP TABLE "reported_items"`);
  }
}
