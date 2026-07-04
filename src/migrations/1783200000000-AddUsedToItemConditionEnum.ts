import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsedToItemConditionEnum1783200000000
  implements MigrationInterface
{
  name = 'AddUsedToItemConditionEnum1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."items_condition_enum" ADD VALUE IF NOT EXISTS 'used'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing a value from an enum directly.
    // Recreate the enum without 'used' and update the column.
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" TYPE VARCHAR(50)`,
    );
    await queryRunner.query(`DROP TYPE "public"."items_condition_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."items_condition_enum" AS ENUM('new', 'like_new', 'good', 'fair', 'poor')`,
    );
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" TYPE "public"."items_condition_enum" USING "condition"::"public"."items_condition_enum"`,
    );
  }
}
