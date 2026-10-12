import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Counts wrong pickup codes so guessing a request's code can be capped, and
 * records when a locked-out requester last asked for a new one.
 */
export class AddPickupAttempts1803000000000 implements MigrationInterface {
  name = 'AddPickupAttempts1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_requests" ADD COLUMN IF NOT EXISTS "pickup_attempts" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" ADD COLUMN IF NOT EXISTS "pickup_code_requested_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP COLUMN IF EXISTS "pickup_code_requested_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP COLUMN IF EXISTS "pickup_attempts"`,
    );
  }
}
