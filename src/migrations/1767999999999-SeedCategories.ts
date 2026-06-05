import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedCategories1767999999999 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO categories (name, slug, icon_url, display_order, is_active, is_deleted)
      VALUES
        ('Antiques', 'antiques', '🗿', 1, true, false),
        ('Music and Entertainment', 'music-and-entertainment', '🎵', 2, true, false),
        ('Books and Stationary', 'books-and-stationary', '📚', 3, true, false),
        ('Household', 'household', '🏠', 4, true, false),
        ('Accessories', 'accessories', '🎧', 5, true, false),
        ('Garage', 'garage', '🚗', 6, true, false),
        ('Pet', 'pet', '🐶', 7, true, false),
        ('Electronics', 'electronics', '📺', 8, true, false),
        ('Sports and Outdoors', 'sports-and-outdoors', '⚽', 9, true, false),
        ('Jewelery and Beauty', 'jewelery-and-beauty', '⚜️', 10, true, false),
        ('Miscellaneous', 'miscellaneous', '📦', 11, true, false),
        ('Arts and Crafts', 'arts-and-crafts', '🎨', 12, true, false),
        ('Clothing and Fashion', 'clothing-and-fashion', '👕', 13, true, false),
        ('Home and Garden', 'home-and-garden', '🌿', 14, true, false),
        ('Babies and Kids', 'babies-and-kids', '👶', 15, true, false)
      ON CONFLICT (slug) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM categories WHERE slug IN (
        'antiques', 'music-and-entertainment', 'books-and-stationary', 'household',
        'accessories', 'garage', 'pet', 'electronics', 'sports-and-outdoors',
        'jewelery-and-beauty', 'miscellaneous', 'arts-and-crafts',
        'clothing-and-fashion', 'home-and-garden', 'babies-and-kids'
      );
    `);
  }
}
