import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Holds the platform settings staff have moved off their default. Keys with
 * no row here follow the defaults in src/platform-settings/settings.registry.ts,
 * so the table starts empty and the app behaves exactly as before.
 */
export class AddPlatformSettings1805000000000 implements MigrationInterface {
  name = 'AddPlatformSettings1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_settings" (
        "key" character varying(100) NOT NULL,
        "value" text NOT NULL,
        "updated_by" uuid,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PLATFORM_SETTINGS" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_settings"
      DROP CONSTRAINT IF EXISTS "FK_PLATFORM_SETTINGS_UPDATED_BY"
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_settings"
      ADD CONSTRAINT "FK_PLATFORM_SETTINGS_UPDATED_BY"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_settings"`);
  }
}
