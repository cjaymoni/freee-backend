/**
 * Names the locations of live items that have coordinates but no area, city
 * or region, such as items posted before LocationNamesService existed, or
 * ones whose background naming failed. Safe to run on every deploy: a named
 * location is never picked again, so a run with nothing to do just exits.
 *
 *   npm run locations:name               after `npm run build`, as in prod
 *   npm run locations:name -- --dry-run  list what would be named
 *   npm run locations:name:dev           from source, without building
 *
 * Reads DATABASE_URL (or DB_HOST and friends) and NOMINATIM_URL from the
 * environment or .env, like the app. Nominatim allows a request a second,
 * so expect about a second per location.
 */
import { join } from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LocationEntity } from '../user/entities/location.entity';
import { LocationNamesService } from '../locations/location-names.service';

config();

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const dataSource = new DataSource({
    type: 'postgres',
    ...(process.env.DATABASE_URL
      ? { url: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_DATABASE || 'freee',
        }),
    // Every entity, as the location's relations need theirs; .js once built.
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    synchronize: false,
  });
  await dataSource.initialize();

  try {
    const rows: { id: string }[] = await dataSource.query(
      `SELECT DISTINCT l.id
         FROM locations l
         JOIN items i ON i.location_id = l.id AND i.is_deleted = false
        WHERE l.is_deleted = false
          AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
          AND l.city IS NULL AND l.area IS NULL AND l.region IS NULL`,
    );
    console.log(`${rows.length} item location(s) without a name`);
    if (dryRun || rows.length === 0) return;

    const names = new LocationNamesService(
      new ConfigService(process.env),
      dataSource.getRepository(LocationEntity),
    );
    let named = 0;
    for (const [index, { id }] of rows.entries()) {
      const ok = await names.fill(id);
      if (ok) named++;
      console.log(
        `[${index + 1}/${rows.length}] ${id} ${ok ? 'named' : 'skipped'}`,
      );
    }
    console.log(`Named ${named} of ${rows.length}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
