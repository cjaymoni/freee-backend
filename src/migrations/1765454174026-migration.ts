import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1765454174026 implements MigrationInterface {
    name = 'Migration1765454174026'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone_number" character varying(20) NOT NULL, "phone_country_code" character varying(5) NOT NULL, "email" character varying(255), "password_hash" character varying(255), "first_name" character varying(100), "last_name" character varying(100), "date_of_birth" date, "gender" character varying(20), "cloudinary_avatar_public_id" character varying(255), "cloudinary_avatar_url" text, "bio" text, "member_since" TIMESTAMP NOT NULL DEFAULT now(), "last_active" TIMESTAMP, "is_verified" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "notification_enabled" boolean NOT NULL DEFAULT true, "failed_login_attempts" integer NOT NULL DEFAULT '0', "account_locked_until" TIMESTAMP, "last_password_change" TIMESTAMP, "requires_password_change" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "deletion_reason" text, "deleted_by" uuid, CONSTRAINT "UQ_17d1817f241f10a3dbafb169fd2" UNIQUE ("phone_number"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")); COMMENT ON COLUMN "users"."password_hash" IS 'bcrypt with 12 rounds'`);
        await queryRunner.query(`CREATE INDEX "idx_users_soft_delete" ON "users" ("is_deleted", "deleted_at") `);
        await queryRunner.query(`CREATE INDEX "idx_users_active" ON "users" ("is_active", "is_deleted", "last_active") `);
        await queryRunner.query(`CREATE INDEX "IDX_c9b5b525a96ddc2c5647d7f7fa" ON "users" ("created_at") `);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_021e2c9d9dca9f0885e8d738326" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_021e2c9d9dca9f0885e8d738326"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c9b5b525a96ddc2c5647d7f7fa"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_active"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_soft_delete"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
