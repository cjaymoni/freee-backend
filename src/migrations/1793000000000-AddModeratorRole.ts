import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModeratorRole1793000000000 implements MigrationInterface {
  name = 'AddModeratorRole1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adding a value leaves existing rows alone, so the users table is not
    // rewritten. Nothing in this transaction uses the new value, which
    // Postgres would refuse before commit.
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'MODERATOR' BEFORE 'ADMIN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop an enum value, so the type is rebuilt without it.
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE VARCHAR(20)`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'USER' WHERE "role" = 'MODERATOR'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'ADMIN')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"public"."users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'`,
    );
  }
}
