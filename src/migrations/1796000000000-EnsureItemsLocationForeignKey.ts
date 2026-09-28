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
 * Skipped entirely if any foreign key already covers location_id, whatever
 * its name or ON DELETE rule: any FK rules out dangling ids, which is all
 * the search needs, and adding one under TypeORM's name next to it could
 * collide. Otherwise dangling values are cleared first so the constraint can
 * be added, under the name TypeORM derives for the relation.
 *
 * Not NOT VALID + VALIDATE: migrations run in one transaction at boot, so
 * the lock taken by ADD would be held until commit either way.
 */
export class EnsureItemsLocationForeignKey1796000000000 implements MigrationInterface {
  name = 'EnsureItemsLocationForeignKey1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // With an FK in place there can be no dangling ids, so the clean-up scan
    // runs only when one has to be added.
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
          UPDATE items SET location_id = NULL
          WHERE location_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = items.location_id);

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
