import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestrictItemConditionEnum1789000000000
  implements MigrationInterface
{
  name = 'RestrictItemConditionEnum1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Collapse the condition enum down to the three values the app allows.
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" TYPE VARCHAR(50)`,
    );
    // like_new maps onto good; fair/poor/used map onto old.
    await queryRunner.query(
      `UPDATE "items" SET "condition" = 'good' WHERE "condition" = 'like_new'`,
    );
    await queryRunner.query(
      `UPDATE "items" SET "condition" = 'old' WHERE "condition" IN ('fair', 'poor', 'used')`,
    );
    await queryRunner.query(`DROP TYPE "public"."items_condition_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."items_condition_enum" AS ENUM('new', 'good', 'old')`,
    );
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" TYPE "public"."items_condition_enum" USING "condition"::"public"."items_condition_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restores the wider enum; rows already collapsed above keep their new values.
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" TYPE VARCHAR(50)`,
    );
    await queryRunner.query(`DROP TYPE "public"."items_condition_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."items_condition_enum" AS ENUM('new', 'like_new', 'good', 'fair', 'poor', 'used')`,
    );
    await queryRunner.query(
      `ALTER TABLE "items" ALTER COLUMN "condition" TYPE "public"."items_condition_enum" USING "condition"::"public"."items_condition_enum"`,
    );
  }
}
