import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1766505186068 implements MigrationInterface {
  name = 'Migration1766505186068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if role column exists to determine if we need to initialize or update
    const roleColumn = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='role'`,
    )) as { column_name: string }[];

    if (roleColumn.length === 0) {
      // Initialize: Create type and add column
      await queryRunner.query(
        `CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'ADMIN')`,
      );
      await queryRunner.query(
        `ALTER TABLE "users" ADD "role" "public"."users_role_enum" NOT NULL DEFAULT 'USER'`,
      );
    } else {
      // Update: This is the original logic but made safer
      await queryRunner.query(
        `ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`,
      );
      await queryRunner.query(
        `CREATE TYPE "public"."users_role_enum" AS ENUM('USER', 'ADMIN')`,
      );
      await queryRunner.query(
        `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
      );
      await queryRunner.query(
        `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING UPPER("role"::text)::"public"."users_role_enum"`,
      );
      await queryRunner.query(
        `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'`,
      );
      await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
