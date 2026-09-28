import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A partial index over locations that lack a latitude or longitude.
 *
 * GET /items near a point keeps listings without coordinates. With the
 * nearby case served by the (latitude, longitude) index, finding those
 * coordinate-less locations was left as the one full scan of the table on
 * every nearby search. The index is small: it only holds those rows.
 *
 * IF NOT EXISTS because a database synchronised from the entities already
 * has it under this name.
 *
 * Not CONCURRENTLY: migrations run in a transaction at boot, and locations
 * is small (one row in the deployed database when this was written), so the
 * brief write lock while it builds costs nothing. Revisit if that changes.
 */
export class AddLocationsMissingCoordinatesIndex1795000000000 implements MigrationInterface {
  name = 'AddLocationsMissingCoordinatesIndex1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_locations_missing_coordinates"
      ON locations (id)
      WHERE latitude IS NULL OR longitude IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_locations_missing_coordinates"`,
    );
  }
}
