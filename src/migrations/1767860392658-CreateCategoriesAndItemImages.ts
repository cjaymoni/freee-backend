import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategoriesAndItemImages1767860392658 implements MigrationInterface {
  name = 'CreateCategoriesAndItemImages1767860392658';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if categories table exists before creating
    const categoriesTableExists = await queryRunner.hasTable('categories');
    if (!categoriesTableExists) {
      await queryRunner.query(
        `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "icon_url" text, "parent_category_id" uuid, "display_order" integer, "is_active" boolean NOT NULL DEFAULT true, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_420d9f679d41281f282f5bc7d09" UNIQUE ("slug"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_categories_active" ON "categories" ("is_active", "is_deleted") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_de08738901be6b34d2824a1e24" ON "categories" ("parent_category_id") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_420d9f679d41281f282f5bc7d0" ON "categories" ("slug") `,
      );
      await queryRunner.query(
        `ALTER TABLE "categories" ADD CONSTRAINT "FK_de08738901be6b34d2824a1e243" FOREIGN KEY ("parent_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }

    // Check if item_images table exists before creating
    const itemImagesTableExists = await queryRunner.hasTable('item_images');
    if (!itemImagesTableExists) {
      await queryRunner.query(
        `CREATE TABLE "item_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "item_id" uuid NOT NULL, "cloudinary_public_id" character varying(255) NOT NULL, "cloudinary_url" text NOT NULL, "cloudinary_secure_url" text NOT NULL, "cloudinary_format" character varying(10), "width" integer, "height" integer, "size_bytes" integer, "display_order" integer NOT NULL DEFAULT '0', "is_primary" boolean NOT NULL DEFAULT false, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_454e093846e50cf1ddca3522035" PRIMARY KEY ("id"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "idx_item_images_item_deleted" ON "item_images" ("item_id", "is_deleted") `,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX "IDX_37868f3899322100c7fde2d1b8" ON "item_images" ("cloudinary_public_id") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_ed6db4b11a596bc85d4e220238" ON "item_images" ("display_order") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_9c2c7fb12650a18c61f758cdfb" ON "item_images" ("item_id") `,
      );
      await queryRunner.query(
        `ALTER TABLE "item_images" ADD CONSTRAINT "FK_9c2c7fb12650a18c61f758cdfb8" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop item_images table and related objects
    const itemImagesTableExists = await queryRunner.hasTable('item_images');
    if (itemImagesTableExists) {
      await queryRunner.query(
        `ALTER TABLE "item_images" DROP CONSTRAINT IF EXISTS "FK_9c2c7fb12650a18c61f758cdfb8"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_9c2c7fb12650a18c61f758cdfb"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_ed6db4b11a596bc85d4e220238"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_37868f3899322100c7fde2d1b8"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."idx_item_images_item_deleted"`,
      );
      await queryRunner.query(`DROP TABLE "item_images"`);
    }

    // Drop categories table and related objects
    const categoriesTableExists = await queryRunner.hasTable('categories');
    if (categoriesTableExists) {
      await queryRunner.query(
        `ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "FK_de08738901be6b34d2824a1e243"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_420d9f679d41281f282f5bc7d0"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."IDX_de08738901be6b34d2824a1e24"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "public"."idx_categories_active"`,
      );
      await queryRunner.query(`DROP TABLE "categories"`);
    }
  }
}
