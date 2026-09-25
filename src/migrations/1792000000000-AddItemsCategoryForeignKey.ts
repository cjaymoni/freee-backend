import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the items.category_id -> categories foreign key the entity has always
 * declared (ON DELETE SET NULL) but no migration created. Without it any UUID
 * could be stored as a category and left dangling.
 *
 * Dangling values are cleared first so the constraint can be added. The
 * constraint uses the name TypeORM derives for the relation, so the entity and
 * schema agree. It is skipped if an equivalent FK already exists - e.g. on a
 * database that was once synchronised from the entities.
 */
export class AddItemsCategoryForeignKey1792000000000 implements MigrationInterface {
  name = 'AddItemsCategoryForeignKey1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE items SET category_id = NULL
      WHERE category_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = items.category_id)
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
            AND con.confrelid = 'categories'::regclass
            AND att.attname = 'category_id'
        ) THEN
          ALTER TABLE items
            ADD CONSTRAINT "FK_0c4aa809ddf5b0c6ca45d8a8e80"
            FOREIGN KEY (category_id) REFERENCES categories(id)
            ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE items DROP CONSTRAINT IF EXISTS "FK_0c4aa809ddf5b0c6ca45d8a8e80"`,
    );
  }
}
