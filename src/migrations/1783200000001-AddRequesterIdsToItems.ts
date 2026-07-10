import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequesterIdsToItems1783200000001 implements MigrationInterface {
  name = 'AddRequesterIdsToItems1783200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" ADD COLUMN "requester_ids" uuid[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "items" DROP COLUMN "requester_ids"`,
    );
  }
}
