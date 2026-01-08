import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateItemsTable1767859975942 implements MigrationInterface {
    name = 'CreateItemsTable1767859975942'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."items_condition_enum" AS ENUM('new', 'like_new', 'good', 'fair', 'poor')`);
        await queryRunner.query(`CREATE TYPE "public"."items_status_enum" AS ENUM('available', 'reserved', 'picked_up', 'unavailable')`);
        await queryRunner.query(`CREATE TABLE "items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "description" text, "category_id" uuid, "condition" "public"."items_condition_enum" NOT NULL, "status" "public"."items_status_enum" NOT NULL DEFAULT 'available', "price" numeric(10,2) NOT NULL DEFAULT '0', "is_free" boolean NOT NULL DEFAULT true, "view_count" integer NOT NULL DEFAULT '0', "location_id" uuid, "pickup_date" date, "is_featured" boolean NOT NULL DEFAULT false, "featured_until" TIMESTAMP, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "deleted_by" uuid, "deletion_reason" character varying(100), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ba5885359424c15ca6b9e79bcf6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_items_soft_delete" ON "items" ("is_deleted", "deleted_at") `);
        await queryRunner.query(`CREATE INDEX "idx_items_featured" ON "items" ("is_featured", "status", "is_deleted", "featured_until") `);
        await queryRunner.query(`CREATE INDEX "idx_items_cat_status" ON "items" ("category_id", "status", "is_deleted", "created_at") `);
        await queryRunner.query(`CREATE INDEX "idx_items_status_created" ON "items" ("status", "is_deleted", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_a3cb147daf5e5970d7f553b1a0" ON "items" ("location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_02c9c7f4f86c3628ba6ec2e02b" ON "items" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_36275759f2cbc3b5ca32f39341" ON "items" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_0c4aa809ddf5b0c6ca45d8a8e8" ON "items" ("category_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_3b934e62fb52bac909e0ddf542" ON "items" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_3b934e62fb52bac909e0ddf5422" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_a3cb147daf5e5970d7f553b1a0b" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_e6a56ecf422fcf2284b9ed57df1" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_e6a56ecf422fcf2284b9ed57df1"`);
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_a3cb147daf5e5970d7f553b1a0b"`);
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_3b934e62fb52bac909e0ddf5422"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3b934e62fb52bac909e0ddf542"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0c4aa809ddf5b0c6ca45d8a8e8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_36275759f2cbc3b5ca32f39341"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_02c9c7f4f86c3628ba6ec2e02b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a3cb147daf5e5970d7f553b1a0"`);
        await queryRunner.query(`DROP INDEX "public"."idx_items_status_created"`);
        await queryRunner.query(`DROP INDEX "public"."idx_items_cat_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_items_featured"`);
        await queryRunner.query(`DROP INDEX "public"."idx_items_soft_delete"`);
        await queryRunner.query(`DROP TABLE "items"`);
        await queryRunner.query(`DROP TYPE "public"."items_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."items_condition_enum"`);
    }

}
