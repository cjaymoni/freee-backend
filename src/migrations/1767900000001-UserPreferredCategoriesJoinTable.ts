import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPreferredCategoriesJoinTable1767900000001
  implements MigrationInterface
{
  name = 'UserPreferredCategoriesJoinTable1767900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create user_preferences if it doesn't exist yet
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_preferences" (
        "id"                    uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id"               uuid NOT NULL,
        "notification_settings" json,
        "language"              character varying(10) NOT NULL DEFAULT 'en',
        "theme"                 character varying(20) NOT NULL DEFAULT 'light',
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_e8cfb5b31af61cd363a6b6d7c25" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_458057fa75b66e68a275647da2e" UNIQUE ("user_id"),
        CONSTRAINT "FK_458057fa75b66e68a275647da2e" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Drop the old JSON column if it exists (local Docker had it)
    await queryRunner.query(
      `ALTER TABLE "user_preferences" DROP COLUMN IF EXISTS "preferred_categories"`,
    );

    // Create the join table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_preferred_categories" (
        "preference_id" uuid NOT NULL,
        "category_id"   uuid NOT NULL,
        CONSTRAINT "pk_user_preferred_categories" PRIMARY KEY ("preference_id", "category_id"),
        CONSTRAINT "fk_upc_preference" FOREIGN KEY ("preference_id")
          REFERENCES "user_preferences"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_upc_category" FOREIGN KEY ("category_id")
          REFERENCES "categories"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_upc_preference_id" ON "user_preferred_categories" ("preference_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_upc_category_id" ON "user_preferred_categories" ("category_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_preferred_categories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_preferences"`);
  }
}
