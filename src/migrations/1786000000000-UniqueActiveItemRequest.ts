import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforce "one active request per requester per item" in the database.
 *
 * The service already serialises this by taking the item row's write lock, so
 * this index is a backstop rather than the primary guard: it holds even for a
 * code path that forgets the lock, a bulk script, or a manual fix-up.
 *
 * Duplicates found on the way in are cancelled rather than deleted, which
 * takes them out of the index predicate while leaving the request history
 * intact. The survivor is the most advanced request - a confirmed one beats a
 * pending one whatever their ages - and the earliest otherwise.
 */
export class UniqueActiveItemRequest1786000000000 implements MigrationInterface {
  name = 'UniqueActiveItemRequest1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE item_requests
      SET status = 'cancelled',
          cancelled_at = now(),
          cancellation_reason =
            'Superseded: duplicate active request for the same item'
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY item_id, requester_id
            ORDER BY (status = 'confirmed') DESC, created_at ASC, id ASC
          ) AS rn
          FROM item_requests
          WHERE status IN ('pending', 'confirmed')
        ) d
        WHERE d.rn > 1
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ITEM_REQUESTS_ACTIVE_PER_REQUESTER"
      ON item_requests (item_id, requester_id)
      WHERE status IN ('pending', 'confirmed')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the constraint comes back: which requests were cancelled above is
    // recorded in cancellation_reason, but their previous status is not.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_ITEM_REQUESTS_ACTIVE_PER_REQUESTER"`,
    );
  }
}
