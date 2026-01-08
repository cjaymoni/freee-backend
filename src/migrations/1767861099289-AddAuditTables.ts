import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditTables1767861099289 implements MigrationInterface {
  name = 'AddAuditTables1767861099289';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create audit tables only - categories, items, and item_images are created in earlier migrations
    const userActivityLogExists =
      await queryRunner.hasTable('user_activity_log');
    if (!userActivityLogExists) {
      await queryRunner.query(
        `CREATE TABLE "user_activity_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "activity_type" character varying(50) NOT NULL, "resource_type" character varying(50), "resource_id" uuid, "ip_address" character varying(45), "device_type" character varying(50), "session_id" uuid, "duration_seconds" integer, "metadata" json, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ca8b900eea707229383724af630" PRIMARY KEY ("id"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_activity_type" ON "user_activity_log" ("activity_type", "created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_activity_user" ON "user_activity_log" ("user_id", "activity_type", "created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_8525b752d6d5e6420d1b21aec3" ON "user_activity_log" ("session_id") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_ae7db694ec69f6c3e6a2337b2d" ON "user_activity_log" ("created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_b1a0e7218976441a88fc893174" ON "user_activity_log" ("activity_type") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_183f150706f5153047a1ef4b89" ON "user_activity_log" ("user_id") `,
      );
      await queryRunner.query(
        `ALTER TABLE "user_activity_log" ADD CONSTRAINT "FK_183f150706f5153047a1ef4b890" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
      await queryRunner.query(
        `ALTER TABLE "user_activity_log" ADD CONSTRAINT "FK_8525b752d6d5e6420d1b21aec3a" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }

    const systemEventsExists = await queryRunner.hasTable('system_events');
    if (!systemEventsExists) {
      const eventTypeEnumExists = await queryRunner.query(
        `SELECT 1 FROM pg_type WHERE typname = 'system_events_event_type_enum'`,
      );
      if (!eventTypeEnumExists || eventTypeEnumExists.length === 0) {
        await queryRunner.query(
          `CREATE TYPE "public"."system_events_event_type_enum" AS ENUM('scheduled_job', 'batch_process', 'system_alert')`,
        );
      }

      const statusEnumExists = await queryRunner.query(
        `SELECT 1 FROM pg_type WHERE typname = 'system_events_status_enum'`,
      );
      if (!statusEnumExists || statusEnumExists.length === 0) {
        await queryRunner.query(
          `CREATE TYPE "public"."system_events_status_enum" AS ENUM('started', 'completed', 'failed')`,
        );
      }

      await queryRunner.query(
        `CREATE TABLE "system_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_type" "public"."system_events_event_type_enum" NOT NULL, "event_name" character varying(100) NOT NULL, "status" "public"."system_events_status_enum" NOT NULL, "description" text, "affected_records" integer, "duration_ms" integer, "error_message" text, "metadata" json, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f28cae54c57b2887d94a4aa745e" PRIMARY KEY ("id"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_system_event_composite" ON "system_events" ("event_type", "status", "created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_dec5ca341c4a120f8f5f0d0e91" ON "system_events" ("created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_06a528c9ad99e80e86baf8fa44" ON "system_events" ("status") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_679474afb1f62f77bfc53d1d78" ON "system_events" ("event_type") `,
      );
    }

    const auditLogsExists = await queryRunner.hasTable('audit_logs');
    if (!auditLogsExists) {
      await queryRunner.query(
        `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "entity_type" character varying(50) NOT NULL, "entity_id" uuid NOT NULL, "action" character varying(50) NOT NULL, "old_values" json, "new_values" json, "changed_fields" json, "ip_address" character varying(45), "user_agent" text, "api_endpoint" character varying(255), "request_method" character varying(10), "success" boolean NOT NULL DEFAULT true, "error_message" text, "metadata" json, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_audit_action" ON "audit_logs" ("entity_type", "action", "created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_audit_user_time" ON "audit_logs" ("user_id", "created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_audit_entity" ON "audit_logs" ("entity_type", "entity_id", "created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_2cd10fda8276bb995288acfbfb" ON "audit_logs" ("created_at") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs" ("action") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_85c204d8e47769ac183b32bf9c" ON "audit_logs" ("entity_id") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_ea9ba3dfb39050f831ee3be40d" ON "audit_logs" ("entity_type") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_bd2726fd31b35443f2245b93ba" ON "audit_logs" ("user_id") `,
      );
      await queryRunner.query(
        `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop audit tables only
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_activity_log" DROP CONSTRAINT "FK_8525b752d6d5e6420d1b21aec3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_activity_log" DROP CONSTRAINT "FK_183f150706f5153047a1ef4b890"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd2726fd31b35443f2245b93ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea9ba3dfb39050f831ee3be40d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85c204d8e47769ac183b32bf9c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cd10fda8276bb995288acfbfb"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_audit_entity"`);
    await queryRunner.query(`DROP INDEX "public"."idx_audit_user_time"`);
    await queryRunner.query(`DROP INDEX "public"."idx_audit_action"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_679474afb1f62f77bfc53d1d78"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_06a528c9ad99e80e86baf8fa44"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dec5ca341c4a120f8f5f0d0e91"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_system_event_composite"`);
    await queryRunner.query(`DROP TABLE "system_events"`);
    await queryRunner.query(`DROP TYPE "public"."system_events_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."system_events_event_type_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_183f150706f5153047a1ef4b89"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1a0e7218976441a88fc893174"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae7db694ec69f6c3e6a2337b2d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8525b752d6d5e6420d1b21aec3"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_activity_user"`);
    await queryRunner.query(`DROP INDEX "public"."idx_activity_type"`);
    await queryRunner.query(`DROP TABLE "user_activity_log"`);
  }
}
