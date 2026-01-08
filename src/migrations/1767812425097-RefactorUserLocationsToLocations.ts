import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorUserLocationsToLocations1767812425097 implements MigrationInterface {
  name = 'RefactorUserLocationsToLocations1767812425097';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if user_locations table exists
    const userLocationsExists = await queryRunner.hasTable('user_locations');

    if (userLocationsExists) {
      // Rename existing table
      await queryRunner.query(
        `ALTER TABLE "user_locations" RENAME TO "locations"`,
      );

      // Add new columns
      await queryRunner.query(
        `ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "address" text`,
      );
      await queryRunner.query(
        `ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "label" character varying(100)`,
      );

      // Make user_id nullable (for temporary locations)
      await queryRunner.query(
        `ALTER TABLE "locations" ALTER COLUMN "user_id" DROP NOT NULL`,
      );
    } else {
      // Create fresh table if user_locations doesn't exist
      await queryRunner.query(
        `CREATE TABLE "locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "country_code" character varying(3) NOT NULL, "country_name" character varying(100) NOT NULL, "region" character varying(100), "city" character varying(100), "area" character varying(100), "address" text, "label" character varying(100), "latitude" numeric(10,8), "longitude" numeric(11,8), "is_current" boolean NOT NULL DEFAULT false, "is_primary" boolean NOT NULL DEFAULT false, "is_deleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_1e830605ea9782ea708164c008" ON "locations" ("is_deleted", "user_id") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_fd51fe5f51c2bf968d92bade10" ON "locations" ("country_code") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_f81075bcc6ed548247c1a33347" ON "locations" ("latitude", "longitude") `,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_6315d9b5cb977506b9f747e097" ON "locations" ("user_id") `,
      );
      await queryRunner.query(
        `ALTER TABLE "locations" ADD CONSTRAINT "FK_6315d9b5cb977506b9f747e0974" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rename back to user_locations
    const locationsExists = await queryRunner.hasTable('locations');

    if (locationsExists) {
      // Remove new columns
      await queryRunner.query(
        `ALTER TABLE "locations" DROP COLUMN IF EXISTS "label"`,
      );
      await queryRunner.query(
        `ALTER TABLE "locations" DROP COLUMN IF EXISTS "address"`,
      );

      // Make user_id not null again
      await queryRunner.query(
        `DELETE FROM "locations" WHERE "user_id" IS NULL`,
      ); // Remove temporary locations
      await queryRunner.query(
        `ALTER TABLE "locations" ALTER COLUMN "user_id" SET NOT NULL`,
      );

      // Rename table back
      await queryRunner.query(
        `ALTER TABLE "locations" RENAME TO "user_locations"`,
      );
    }
  }
}
