import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSearchQueries1790000000000 implements MigrationInterface {
  name = 'CreateSearchQueries1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backs GET /search/popular. Holds no user ID or IP, only a daily salted
    // hash, and rows older than the ranking window are purged daily.
    await queryRunner.query(
      `CREATE TABLE "search_queries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "term" character varying(100) NOT NULL,
        "searcher_hash" character varying(64) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_search_queries_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_SEARCH_QUERIES_TERM_SEARCHER" ON "search_queries" ("term", "searcher_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_search_queries_created_at" ON "search_queries" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_search_queries_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_SEARCH_QUERIES_TERM_SEARCHER"`,
    );
    await queryRunner.query(`DROP TABLE "search_queries"`);
  }
}
