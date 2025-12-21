import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissingEntities1766350297086 implements MigrationInterface {
    name = 'AddMissingEntities1766350297086'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "user_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "session_token" character varying(255) NOT NULL, "device_id" character varying(255), "device_name" character varying(255), "device_type" character varying(50), "ip_address" character varying(45), "user_agent" text, "fcm_token" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "refresh_token" character varying(255), "refresh_token_expires_at" TIMESTAMP, "last_activity" TIMESTAMP NOT NULL DEFAULT now(), "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "UQ_e5eb7a3c7766f941fe16b9edecb" UNIQUE ("session_token"), CONSTRAINT "UQ_69214fd09be67af95c186be26db" UNIQUE ("refresh_token"), CONSTRAINT "PK_e93e031a5fed190d4789b6bfd83" PRIMARY KEY ("id")); COMMENT ON COLUMN "user_sessions"."device_type" IS 'ios, android, web'; COMMENT ON COLUMN "user_sessions"."fcm_token" IS 'Firebase Cloud Messaging for push notifications'`);
        await queryRunner.query(`CREATE INDEX "idx_sessions_cleanup" ON "user_sessions" ("is_active", "last_activity") `);
        await queryRunner.query(`CREATE INDEX "IDX_dbc81ff542b1b3366bae195f2a" ON "user_sessions" ("expires_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_2c6e259a9af837c1a7090bdda1" ON "user_sessions" ("user_id", "is_active") `);
        await queryRunner.query(`CREATE INDEX "IDX_e5eb7a3c7766f941fe16b9edec" ON "user_sessions" ("session_token") `);
        await queryRunner.query(`CREATE TABLE "verification_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone_number" character varying(20), "email" character varying(255), "code_hash" character varying(255) NOT NULL, "code_type" character varying(20) NOT NULL, "ip_address" character varying(45), "attempt_count" integer NOT NULL DEFAULT '0', "is_verified" boolean NOT NULL DEFAULT false, "verified_at" TIMESTAMP, "expires_at" TIMESTAMP NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_18741b6b8bf1680dbf5057421d7" PRIMARY KEY ("id")); COMMENT ON COLUMN "verification_codes"."code_type" IS 'phone_verification, email_verification, 2fa'`);
        await queryRunner.query(`CREATE INDEX "IDX_90d67965bc26f2663d1f38cd42" ON "verification_codes" ("code_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_389cd06509d9d78dae3758d46f" ON "verification_codes" ("expires_at", "is_verified") `);
        await queryRunner.query(`CREATE INDEX "IDX_eece521909dea6cbe1c8238ee8" ON "verification_codes" ("user_id", "phone_number", "email") `);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone_number" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone_country_code" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_sessions" ADD CONSTRAINT "FK_e9658e959c490b0a634dfc54783" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "verification_codes" ADD CONSTRAINT "FK_0a53c41a810420ee446082ce6c6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "verification_codes" DROP CONSTRAINT "FK_0a53c41a810420ee446082ce6c6"`);
        await queryRunner.query(`ALTER TABLE "user_sessions" DROP CONSTRAINT "FK_e9658e959c490b0a634dfc54783"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone_country_code" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone_number" SET NOT NULL`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eece521909dea6cbe1c8238ee8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_389cd06509d9d78dae3758d46f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_90d67965bc26f2663d1f38cd42"`);
        await queryRunner.query(`DROP TABLE "verification_codes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e5eb7a3c7766f941fe16b9edec"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c6e259a9af837c1a7090bdda1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dbc81ff542b1b3366bae195f2a"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sessions_cleanup"`);
        await queryRunner.query(`DROP TABLE "user_sessions"`);
    }

}
