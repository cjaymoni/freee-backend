import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two-sided pickup: either party taps "Picked up" and the other confirms.
 * Records who marked it and when, and when the waiting party was last
 * reminded. All nullable, so existing rows need no backfill.
 */
export class AddPickupConfirmation1806000000000 implements MigrationInterface {
  name = 'AddPickupConfirmation1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "item_requests" ADD COLUMN IF NOT EXISTS "pickup_marked_by" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" ADD COLUMN IF NOT EXISTS "pickup_marked_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" ADD COLUMN IF NOT EXISTS "pickup_reminded_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP CONSTRAINT IF EXISTS "FK_item_requests_pickup_marked_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" ADD CONSTRAINT "FK_item_requests_pickup_marked_by" FOREIGN KEY ("pickup_marked_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    // The reminder job scans only confirmed requests someone has marked, and
    // filters and sorts on when the waiting party was last nudged.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_item_requests_pickup_awaiting" ON "item_requests" ((COALESCE("pickup_reminded_at", "pickup_marked_at"))) WHERE "pickup_marked_by" IS NOT NULL AND "status" = 'confirmed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_item_requests_pickup_awaiting"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP CONSTRAINT IF EXISTS "FK_item_requests_pickup_marked_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP COLUMN IF EXISTS "pickup_reminded_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP COLUMN IF EXISTS "pickup_marked_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "item_requests" DROP COLUMN IF EXISTS "pickup_marked_by"`,
    );
  }
}
