import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make sure items.location_id -> locations has its foreign key (ON DELETE
 * SET NULL), as the entity declares. CreateItemsTable only adds it when it
 * creates the table, so an items table that already existed may lack it.
 *
 * It matters for GET /items near a point: listings with no coordinates are
 * kept, but one whose location_id names a row that no longer exists would
 * be neither "no location" nor "a location" and silently drop out.
 *
 * Dangling values are cleared first so the constraint can be added. The
 * constraint uses the name TypeORM derives for the relation, and is skipped
 * if an equivalent FK already exists.
 */
export class EnsureItemsLocationForeignKey1796000000000 implements MigrationInterface {
  name = 'EnsureItemsLocationForeignKey1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE items SET location_id = NULL
      WHERE location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = items.location_id)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint con
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
          WHERE con.contype = 'f'
            AND con.conrelid = 'items'::regclass
            AND con.confrelid = 'locations'::regclass
            AND att.attname = 'location_id'
        ) THEN
          ALTER TABLE items
            ADD CONSTRAINT "FK_a3cb147daf5e5970d7f553b1a0b"
            FOREIGN KEY (location_id) REFERENCES locations(id)
            ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$
    `);
  }

  public async down(): Promise<void> {
    // Nothing to undo: the constraint belongs to CreateItemsTable, whose own
    // down drops it, and this migration may have found it already there.
  }
}
