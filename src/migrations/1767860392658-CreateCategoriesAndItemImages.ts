import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCategoriesAndItemImages1767860392658 implements MigrationInterface {
    name = 'CreateCategoriesAndItemImages1767860392658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "icon_url" text, "parent_category_id" uuid, "display_order" integer, "is_active" boolean NOT NULL DEFAULT true, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_420d9f679d41281f282f5bc7d09" UNIQUE ("slug"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_categories_active" ON "categories" ("is_active", "is_deleted") `);
        await queryRunner.query(`CREATE INDEX "IDX_de08738901be6b34d2824a1e24" ON "categories" ("parent_category_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_420d9f679d41281f282f5bc7d0" ON "categories" ("slug") `);
        await queryRunner.query(`CREATE TABLE "item_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "item_id" uuid NOT NULL, "cloudinary_public_id" character varying(255) NOT NULL, "cloudinary_url" text NOT NULL, "cloudinary_secure_url" text NOT NULL, "cloudinary_format" character varying(10), "width" integer, "height" integer, "size_bytes" integer, "display_order" integer NOT NULL DEFAULT '0', "is_primary" boolean NOT NULL DEFAULT false, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_454e093846e50cf1ddca3522035" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_item_images_item_deleted" ON "item_images" ("item_id", "is_deleted") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_37868f3899322100c7fde2d1b8" ON "item_images" ("cloudinary_public_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ed6db4b11a596bc85d4e220238" ON "item_images" ("display_order") `);
        await queryRunner.query(`CREATE INDEX "IDX_9c2c7fb12650a18c61f758cdfb" ON "item_images" ("item_id") `);
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
        await queryRunner.query(`ALTER TABLE "categories" ADD CONSTRAINT "FK_de08738901be6b34d2824a1e243" FOREIGN KEY ("parent_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "item_images" ADD CONSTRAINT "FK_9c2c7fb12650a18c61f758cdfb8" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_3b934e62fb52bac909e0ddf5422" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_0c4aa809ddf5b0c6ca45d8a8e80" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_a3cb147daf5e5970d7f553b1a0b" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items" ADD CONSTRAINT "FK_e6a56ecf422fcf2284b9ed57df1" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_e6a56ecf422fcf2284b9ed57df1"`);
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_a3cb147daf5e5970d7f553b1a0b"`);
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_0c4aa809ddf5b0c6ca45d8a8e80"`);
        await queryRunner.query(`ALTER TABLE "items" DROP CONSTRAINT "FK_3b934e62fb52bac909e0ddf5422"`);
        await queryRunner.query(`ALTER TABLE "item_images" DROP CONSTRAINT "FK_9c2c7fb12650a18c61f758cdfb8"`);
        await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_de08738901be6b34d2824a1e243"`);
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
        await queryRunner.query(`DROP INDEX "public"."IDX_9c2c7fb12650a18c61f758cdfb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed6db4b11a596bc85d4e220238"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_37868f3899322100c7fde2d1b8"`);
        await queryRunner.query(`DROP INDEX "public"."idx_item_images_item_deleted"`);
        await queryRunner.query(`DROP TABLE "item_images"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_420d9f679d41281f282f5bc7d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_de08738901be6b34d2824a1e24"`);
        await queryRunner.query(`DROP INDEX "public"."idx_categories_active"`);
        await queryRunner.query(`DROP TABLE "categories"`);
    }

}
