import { MigrationInterface, QueryRunner } from 'typeorm';

/** In-app banners staff schedule from the back office. */
export class AddAnnouncements1802000000000 implements MigrationInterface {
  name = 'AddAnnouncements1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "announcements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "message" varchar(280) NOT NULL,
        "level" varchar(20) NOT NULL DEFAULT 'info',
        "active_from" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "active_until" TIMESTAMP,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_announcements_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_announcements_active" ON "announcements" ("is_active", "active_from")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "announcements"`);
  }
}
