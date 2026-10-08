import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Announcements staff send from the back office, with their audience and
 * delivery counts, for the Notifications history.
 */
export class AddAdminNotifications1800000000000 implements MigrationInterface {
  name = 'AddAdminNotifications1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" varchar(100) NOT NULL,
        "body" varchar(500) NOT NULL,
        "send_email" boolean NOT NULL DEFAULT false,
        "audience" jsonb NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'sending',
        "recipient_count" integer NOT NULL DEFAULT 0,
        "push_sent_count" integer NOT NULL DEFAULT 0,
        "email_sent_count" integer NOT NULL DEFAULT 0,
        "failure_count" integer NOT NULL DEFAULT 0,
        "sent_by" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP,
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_sent_by" FOREIGN KEY ("sent_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notifications_created_at" ON "notifications" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
