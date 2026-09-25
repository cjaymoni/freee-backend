import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let a user block and unblock the same person any number of times.
 *
 * The old unique index covered (blocker_id, blocked_id, is_deleted), so after
 * one block/unblock cycle a second unblock tried to write a second
 * (A, B, true) row and failed with a duplicate key - leaving the block in
 * place for good. Only one *active* block per pair needs to be unique; the
 * soft-deleted rows are history and may repeat.
 *
 * The entity declares the same index, so a development database synchronised
 * from the entities may already have it; creation is skipped in that case.
 */
export class UniqueActiveBlock1791000000000 implements MigrationInterface {
  name = 'UniqueActiveBlock1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_blocked_users_unique"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_BLOCKED_USERS_ACTIVE_PAIR"
      ON blocked_users (blocker_id, blocked_id)
      WHERE is_deleted = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The old index allows one soft-deleted row per pair, so extra unblock
    // history has to go before it can come back; the newest row is kept.
    await queryRunner.query(`
      DELETE FROM blocked_users
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY blocker_id, blocked_id
            ORDER BY deleted_at DESC NULLS LAST, created_at DESC, id DESC
          ) AS rn
          FROM blocked_users
          WHERE is_deleted = true
        ) d
        WHERE d.rn > 1
      )
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_BLOCKED_USERS_ACTIVE_PAIR"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_blocked_users_unique" ON "blocked_users" ("blocker_id", "blocked_id", "is_deleted")`,
    );
  }
}
