import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Items can be posted with nothing but coordinates, which produces a location
 * row that has no country attached. Nothing in the application reads these two
 * columns beyond echoing them back, so they become optional.
 */
export class MakeLocationCountryNullable1787000000000
  implements MigrationInterface
{
  name = 'MakeLocationCountryNullable1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "locations" ALTER COLUMN "country_code" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "locations" ALTER COLUMN "country_name" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fails if any coordinate-only location has been created since. Those rows
    // must be given a country, or removed, before rolling back.
    await queryRunner.query(
      `ALTER TABLE "locations" ALTER COLUMN "country_name" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "locations" ALTER COLUMN "country_code" SET NOT NULL`,
    );
  }
}
