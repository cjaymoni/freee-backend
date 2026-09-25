import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModeratorRole1791000000000 implements MigrationInterface {
  name = 'AddModeratorRole1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Recreated rather than ALTER TYPE ... ADD VALUE, which cannot be used in
    // the same transaction that adds it.
    await this.setRoles(queryRunner, ['USER', 'MODERATOR', 'ADMIN']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setRoles(queryRunner, ['USER', 'ADMIN'], () =>
      queryRunner.query(
        `UPDATE "users" SET "role" = 'USER' WHERE "role" = 'MODERATOR'`,
      ),
    );
  }

  private async setRoles(
    queryRunner: QueryRunner,
    roles: string[],
    beforeRecreate?: () => Promise<unknown>,
  ) {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE VARCHAR(20)`,
    );
    await beforeRecreate?.();
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM(${roles.map((r) => `'${r}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"public"."users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'`,
    );
  }
}
