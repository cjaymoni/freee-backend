import { MigrationInterface, QueryRunner } from 'typeorm';

export class DedupeItemViews1784000000000 implements MigrationInterface {
  name = 'DedupeItemViews1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Collapse pre-existing duplicate view rows, keeping the earliest one
    //    per (item, viewer) for authenticated views...
    await queryRunner.query(`
      DELETE FROM item_views
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY item_id, viewer_id
            ORDER BY created_at ASC, id ASC
          ) AS rn
          FROM item_views
          WHERE viewer_id IS NOT NULL
        ) d
        WHERE d.rn > 1
      )
    `);

    //    ...and per (item, ip) for anonymous views.
    await queryRunner.query(`
      DELETE FROM item_views
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY item_id, ip_address
            ORDER BY created_at ASC, id ASC
          ) AS rn
          FROM item_views
          WHERE viewer_id IS NULL
        ) d
        WHERE d.rn > 1
      )
    `);

    // 2. Enforce one view per viewer per item at the database level, so
    //    concurrent requests cannot both insert a row.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ITEM_VIEWS_ITEM_VIEWER"
      ON item_views (item_id, viewer_id)
      WHERE viewer_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ITEM_VIEWS_ITEM_IP_ANON"
      ON item_views (item_id, ip_address)
      WHERE viewer_id IS NULL
    `);

    // 3. Repair items.view_count, which was inflated by one per GET /items/:id
    //    request regardless of whether the viewer had already seen the item.
    await queryRunner.query(`
      UPDATE items i
      SET view_count = c.count
      FROM (
        SELECT i2.id, COALESCE(v.count, 0)::int AS count
        FROM items i2
        LEFT JOIN (
          SELECT item_id, COUNT(*) AS count
          FROM item_views
          GROUP BY item_id
        ) v ON v.item_id = i2.id
      ) c
      WHERE i.id = c.id AND i.view_count <> c.count
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The deleted duplicate rows and the original inflated counts are not
    // recoverable; only the constraints are dropped.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_ITEM_VIEWS_ITEM_IP_ANON"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ITEM_VIEWS_ITEM_VIEWER"`);
  }
}
