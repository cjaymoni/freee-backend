import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPickedByIdToItems1783200000002 implements MigrationInterface {
  name = 'AddPickedByIdToItems1783200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "picked_by_id" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "items" ADD CONSTRAINT "FK_items_picked_by_id" FOREIGN KEY ("picked_by_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP CONSTRAINT "FK_items_picked_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "items" DROP COLUMN "picked_by_id"`,
    );
  }
}
