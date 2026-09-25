import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeEntityIdNullable1781626271175 implements MigrationInterface {
    name = 'MakeEntityIdNullable1781626271175'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // suspicious_activities and api_rate_limits (with these exact index and
        // FK names) are already created by AddMissingEntities1766350297086, so
        // on any database built from the migrations in order the plain CREATEs
        // failed. They are guarded so only the audit_logs change applies there.
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "suspicious_activities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "activity_type" character varying(50) NOT NULL, "severity" character varying(20) NOT NULL, "ip_address" character varying(45), "description" text, "metadata" json, "is_resolved" boolean NOT NULL DEFAULT false, "resolved_at" TIMESTAMP, "action_taken" character varying(100), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, "resolved_by" uuid, CONSTRAINT "PK_c03f5576ed92d11f99d98ebf281" PRIMARY KEY ("id")); COMMENT ON COLUMN "suspicious_activities"."activity_type" IS 'brute_force, spam, scraping, unusual_location'; COMMENT ON COLUMN "suspicious_activities"."severity" IS 'low, medium, high, critical'; COMMENT ON COLUMN "suspicious_activities"."metadata" IS 'Additional context data'; COMMENT ON COLUMN "suspicious_activities"."action_taken" IS 'account_locked, ip_blocked, warning_sent'`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_98f65155465bd21525b29a52bc" ON "suspicious_activities" ("created_at") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_528c766656cda6c55a8a604fbf" ON "suspicious_activities" ("is_resolved", "created_at") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_6b4c080d4e731e0e2594dee96a" ON "suspicious_activities" ("severity") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ee5cfe13e412e6ac73eac88b67" ON "suspicious_activities" ("activity_type") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_51d34c07bfeddea088e787f49b" ON "suspicious_activities" ("ip_address") `);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "api_rate_limits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ip_address" character varying(45), "endpoint" character varying(255) NOT NULL, "request_count" integer NOT NULL DEFAULT '1', "window_start" TIMESTAMP NOT NULL, "window_end" TIMESTAMP NOT NULL, "is_blocked" boolean NOT NULL DEFAULT false, "blocked_until" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_95483f6eba466f9a1ad351edcbf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_591eb21679d4e9506403344280" ON "api_rate_limits" ("window_end") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_rate_limit_ip" ON "api_rate_limits" ("ip_address", "endpoint", "window_end") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_rate_limit_user" ON "api_rate_limits" ("user_id", "endpoint", "window_end") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_fc5bf8e493b71131e4879f24dd" ON "api_rate_limits" ("endpoint") `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_d68c32d482d1d5e91f094a31a6" ON "api_rate_limits" ("ip_address") `);
        await queryRunner.query(`DROP INDEX "public"."idx_audit_entity"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "entity_id" DROP NOT NULL`);
        await queryRunner.query(`CREATE INDEX "idx_audit_entity" ON "audit_logs" ("entity_type", "entity_id", "created_at") `);
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_5a44886f49e852d74d77e7145ef') THEN ALTER TABLE "suspicious_activities" ADD CONSTRAINT "FK_5a44886f49e852d74d77e7145ef" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION; END IF; END $$`);
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_970b6c04f521c3e54fd4ed1ae13') THEN ALTER TABLE "suspicious_activities" ADD CONSTRAINT "FK_970b6c04f521c3e54fd4ed1ae13" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; END IF; END $$`);
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_8e890499862a4444e6e439f18e8') THEN ALTER TABLE "api_rate_limits" ADD CONSTRAINT "FK_8e890499862a4444e6e439f18e8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION; END IF; END $$`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // The tables above belong to AddMissingEntities1766350297086; only undo
        // this migration's own change.
        await queryRunner.query(`DROP INDEX "public"."idx_audit_entity"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ALTER COLUMN "entity_id" SET NOT NULL`);
        await queryRunner.query(`CREATE INDEX "idx_audit_entity" ON "audit_logs" ("entity_type", "entity_id", "created_at") `);
    }

}
