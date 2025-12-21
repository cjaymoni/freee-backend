import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1766258152029 implements MigrationInterface {
    name = 'Migration1766258152029'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "suspicious_activities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "activity_type" character varying(50) NOT NULL, "severity" character varying(20) NOT NULL, "ip_address" character varying(45), "description" text, "metadata" json, "is_resolved" boolean NOT NULL DEFAULT false, "resolved_at" TIMESTAMP, "action_taken" character varying(100), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, "resolved_by" uuid, CONSTRAINT "PK_c03f5576ed92d11f99d98ebf281" PRIMARY KEY ("id")); COMMENT ON COLUMN "suspicious_activities"."activity_type" IS 'brute_force, spam, scraping, unusual_location'; COMMENT ON COLUMN "suspicious_activities"."severity" IS 'low, medium, high, critical'; COMMENT ON COLUMN "suspicious_activities"."metadata" IS 'Additional context data'; COMMENT ON COLUMN "suspicious_activities"."action_taken" IS 'account_locked, ip_blocked, warning_sent'`);
        await queryRunner.query(`CREATE INDEX "IDX_98f65155465bd21525b29a52bc" ON "suspicious_activities" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_528c766656cda6c55a8a604fbf" ON "suspicious_activities" ("is_resolved", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_6b4c080d4e731e0e2594dee96a" ON "suspicious_activities" ("severity") `);
        await queryRunner.query(`CREATE INDEX "IDX_ee5cfe13e412e6ac73eac88b67" ON "suspicious_activities" ("activity_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_51d34c07bfeddea088e787f49b" ON "suspicious_activities" ("ip_address") `);
        await queryRunner.query(`CREATE TABLE "login_attempts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone_number" character varying(20), "email" character varying(255), "ip_address" character varying(45) NOT NULL, "device_id" character varying(255), "user_agent" text, "attempt_result" character varying(20) NOT NULL, "failure_reason" character varying(100), "geolocation" json, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_070e613c8f768b1a70742705c5b" PRIMARY KEY ("id")); COMMENT ON COLUMN "login_attempts"."attempt_result" IS 'success, failed, blocked'; COMMENT ON COLUMN "login_attempts"."failure_reason" IS 'invalid_password, account_locked, account_not_found'; COMMENT ON COLUMN "login_attempts"."geolocation" IS 'Country, city from IP'`);
        await queryRunner.query(`CREATE INDEX "idx_login_user_time" ON "login_attempts" ("user_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "idx_login_ip_time" ON "login_attempts" ("ip_address", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_fb1343b1ae1968a348d1ebea73" ON "login_attempts" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_8708cd4de43f55001fc1734ca0" ON "login_attempts" ("ip_address") `);
        await queryRunner.query(`CREATE INDEX "IDX_b3bb3f128e0c654b481901f7eb" ON "login_attempts" ("phone_number") `);
        await queryRunner.query(`CREATE TABLE "api_rate_limits" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ip_address" character varying(45), "endpoint" character varying(255) NOT NULL, "request_count" integer NOT NULL DEFAULT '1', "window_start" TIMESTAMP NOT NULL, "window_end" TIMESTAMP NOT NULL, "is_blocked" boolean NOT NULL DEFAULT false, "blocked_until" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_95483f6eba466f9a1ad351edcbf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_591eb21679d4e9506403344280" ON "api_rate_limits" ("window_end") `);
        await queryRunner.query(`CREATE INDEX "idx_rate_limit_ip" ON "api_rate_limits" ("ip_address", "endpoint", "window_end") `);
        await queryRunner.query(`CREATE INDEX "idx_rate_limit_user" ON "api_rate_limits" ("user_id", "endpoint", "window_end") `);
        await queryRunner.query(`CREATE INDEX "IDX_fc5bf8e493b71131e4879f24dd" ON "api_rate_limits" ("endpoint") `);
        await queryRunner.query(`CREATE INDEX "IDX_d68c32d482d1d5e91f094a31a6" ON "api_rate_limits" ("ip_address") `);
        await queryRunner.query(`ALTER TABLE "suspicious_activities" ADD CONSTRAINT "FK_5a44886f49e852d74d77e7145ef" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "suspicious_activities" ADD CONSTRAINT "FK_970b6c04f521c3e54fd4ed1ae13" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "login_attempts" ADD CONSTRAINT "FK_5f88175f39e2b2ebf9e2295a9fd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "api_rate_limits" ADD CONSTRAINT "FK_8e890499862a4444e6e439f18e8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "api_rate_limits" DROP CONSTRAINT "FK_8e890499862a4444e6e439f18e8"`);
        await queryRunner.query(`ALTER TABLE "login_attempts" DROP CONSTRAINT "FK_5f88175f39e2b2ebf9e2295a9fd"`);
        await queryRunner.query(`ALTER TABLE "suspicious_activities" DROP CONSTRAINT "FK_970b6c04f521c3e54fd4ed1ae13"`);
        await queryRunner.query(`ALTER TABLE "suspicious_activities" DROP CONSTRAINT "FK_5a44886f49e852d74d77e7145ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d68c32d482d1d5e91f094a31a6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fc5bf8e493b71131e4879f24dd"`);
        await queryRunner.query(`DROP INDEX "public"."idx_rate_limit_user"`);
        await queryRunner.query(`DROP INDEX "public"."idx_rate_limit_ip"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_591eb21679d4e9506403344280"`);
        await queryRunner.query(`DROP TABLE "api_rate_limits"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b3bb3f128e0c654b481901f7eb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8708cd4de43f55001fc1734ca0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb1343b1ae1968a348d1ebea73"`);
        await queryRunner.query(`DROP INDEX "public"."idx_login_ip_time"`);
        await queryRunner.query(`DROP INDEX "public"."idx_login_user_time"`);
        await queryRunner.query(`DROP TABLE "login_attempts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_51d34c07bfeddea088e787f49b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee5cfe13e412e6ac73eac88b67"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b4c080d4e731e0e2594dee96a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_528c766656cda6c55a8a604fbf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_98f65155465bd21525b29a52bc"`);
        await queryRunner.query(`DROP TABLE "suspicious_activities"`);
    }

}
