import { MigrationInterface, QueryRunner } from 'typeorm';

/** Each staff member's back office inbox. */
export class AddStaffNotifications1801000000000 implements MigrationInterface {
  name = 'AddStaffNotifications1801000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "staff_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "type" varchar(40) NOT NULL,
        "title" varchar(150) NOT NULL,
        "body" varchar(500),
        "link" varchar(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "read_at" TIMESTAMP,
        CONSTRAINT "PK_staff_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_staff_notifications_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_notifications_user_created" ON "staff_notifications" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_staff_notifications_user_read" ON "staff_notifications" ("user_id", "read_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "staff_notifications"`);
  }
}
