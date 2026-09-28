import { readdirSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ItemService } from './item.service';
import {
  ItemCondition,
  ItemEntity,
  ModerationStatus,
} from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { CategoryEntity } from '../category/entities/category.entity';
import { LocationEntity } from '../user/entities/location.entity';
import { UserEntity } from '../user/entities/user.entity';

/**
 * GET /items against a real Postgres: paging over the images join, the
 * distance SQL and category matching can only be proven on actual rows.
 *
 * Runs only when TEST_DATABASE_URL names a disposable database, e.g.
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=freee_test postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/freee_test \
 *     npx jest item.service.db
 * The schema is dropped and rebuilt from the entities on every run.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

/** Every entity, since relations reach across modules. */
function allEntities(dir = join(__dirname, '..')): unknown[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return allEntities(path);
    if (!entry.name.endsWith('.entity.ts')) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return Object.values(require(path) as Record<string, unknown>).filter(
      (value) => typeof value === 'function',
    );
  });
}

/** Reference great-circle distance in km, the same formula as the SQL. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const ACCRA = { lat: 5.6037, lng: -0.187 };
const PLACES = {
  accra: ACCRA,
  osu: { lat: 5.556, lng: -0.1769 }, // ~5.5 km from Accra
  kumasi: { lat: 6.6885, lng: -1.6244 }, // ~200 km
  nullIsland: { lat: 0, lng: 0 },
  fiji: { lat: -17.75, lng: 179.95 }, // just west of the antimeridian
  arctic: { lat: 89.95, lng: 170 }, // ~7 km from 89.99,0 over the pole side
};

describeDb('ItemService.findAll on Postgres', () => {
  let ds: DataSource;
  let service: ItemService;
  const ids: Record<string, string> = {};
  const coords: Record<string, { lat: number; lng: number } | null> = {};

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url,
      entities: allEntities() as never[],
      synchronize: true,
      dropSchema: true,
      logging: false,
    }).initialize();

    service = new ItemService(
      ds.getRepository(ItemEntity),
      ds.getRepository(ItemImageEntity),
      { find: () => Promise.resolve([]) } as never,
      ds.getRepository(LocationEntity),
      {} as never,
      {} as never,
      ds,
      { record: () => Promise.resolve() } as never,
    );

    const users = ds.getRepository(UserEntity);
    const [alice, bob] = await users.save([
      { email: 'alice@example.com', first_name: 'Alice' },
      { email: 'bob@example.com', first_name: 'Bob' },
    ]);

    const categories = ds.getRepository(CategoryEntity);
    const parent = await categories.save({
      name: 'Furniture',
      slug: 'furniture',
    });
    const [sub, other] = await categories.save([
      { name: 'Chairs', slug: 'chairs', parent_category_id: parent.id },
      { name: 'Books', slug: 'books' },
    ]);
    ids.parent = parent.id;
    ids.sub = sub.id;
    ids.other = other.id;

    const locations = ds.getRepository(LocationEntity);
    const locationIds: Record<string, string> = {};
    for (const [name, { lat, lng }] of Object.entries(PLACES)) {
      const saved = await locations.save({ latitude: lat, longitude: lng });
      locationIds[name] = saved.id;
    }

    // created_at is set afterwards so the order, and one tie, are exact.
    const seed: {
      key: string;
      by: UserEntity;
      place: keyof typeof PLACES | null;
      category?: string;
      images: number;
      minutesAgo: number;
      extra?: Partial<ItemEntity>;
    }[] = [
      {
        key: 'accraChair',
        by: alice,
        place: 'accra',
        category: sub.id,
        images: 3,
        minutesAgo: 1,
      },
      {
        key: 'kumasiTable',
        by: bob,
        place: 'kumasi',
        category: parent.id,
        images: 1,
        minutesAgo: 2,
      },
      {
        key: 'noLocation',
        by: alice,
        place: null,
        category: other.id,
        images: 0,
        minutesAgo: 3,
      },
      {
        key: 'nullIsland',
        by: bob,
        place: 'nullIsland',
        category: sub.id,
        images: 2,
        minutesAgo: 3,
      },
      {
        key: 'osuLamp',
        by: alice,
        place: 'osu',
        images: 1,
        minutesAgo: 4,
        extra: { title: 'Crème lamp' },
      },
      {
        key: 'deleted',
        by: alice,
        place: 'accra',
        images: 1,
        minutesAgo: 5,
        extra: { is_deleted: true },
      },
      {
        key: 'hidden',
        by: alice,
        place: 'accra',
        images: 0,
        minutesAgo: 6,
        extra: { moderation_status: ModerationStatus.HIDDEN },
      },
      { key: 'fiji', by: bob, place: 'fiji', images: 0, minutesAgo: 7 },
      { key: 'arctic', by: bob, place: 'arctic', images: 0, minutesAgo: 8 },
    ];
    const now = Date.now();
    for (const row of seed) {
      const itemRepo = ds.getRepository(ItemEntity);
      const item = await itemRepo.save(
        itemRepo.create({
          title: row.key,
          condition: ItemCondition.GOOD,
          user_id: row.by.id,
          location_id: row.place ? locationIds[row.place] : null,
          category_id: row.category ?? null,
          ...row.extra,
        } as Partial<ItemEntity>),
      );
      await ds.query('UPDATE items SET created_at = $1 WHERE id = $2', [
        new Date(now - row.minutesAgo * 60_000),
        item.id,
      ]);
      await ds.getRepository(ItemImageEntity).save(
        Array.from({ length: row.images }, (_, i) => ({
          item_id: item.id,
          cloudinary_public_id: `items/${row.key}-${i}`,
          cloudinary_url: `https://example.com/${row.key}-${i}.jpg`,
          cloudinary_secure_url: `https://example.com/${row.key}-${i}.jpg`,
          display_order: i,
          is_primary: i === 0,
        })),
      );
      ids[row.key] = item.id;
      coords[row.key] = row.place ? PLACES[row.place] : null;
    }
    ids.alice = alice.id;
    ids.bob = bob.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const keysOf = (data: { id: string }[]) =>
    data.map(({ id }) => Object.keys(ids).find((key) => ids[key] === id));

  const VISIBLE = [
    'accraChair',
    'kumasiTable',
    'noLocation',
    'nullIsland',
    'osuLamp',
    'fiji',
    'arctic',
  ];

  it('walks every visible item once, newest first, across pages', async () => {
    const seen: string[] = [];
    let total = 0;
    for (let page = 1; page <= 4; page++) {
      const result = await service.findAll({ page, limit: 2 });
      total = result.total!;
      seen.push(...(keysOf(result.data) as string[]));
    }

    expect(total).toBe(7);
    expect(new Set(seen).size).toBe(seen.length);
    // noLocation and nullIsland share a created_at; the id decides.
    const [tieFirst, tieSecond] = [ids.noLocation, ids.nullIsland]
      .sort()
      .reverse();
    expect(seen).toEqual([
      'accraChair',
      'kumasiTable',
      keysOf([{ id: tieFirst }])[0],
      keysOf([{ id: tieSecond }])[0],
      'osuLamp',
      'fiji',
      'arctic',
    ]);
  });

  it('keeps every image of an item on a page, not one row per image', async () => {
    const result = await service.findAll({ page: 1, limit: 1 });
    expect(keysOf(result.data)).toEqual(['accraChair']);
    expect(result.data[0].images).toHaveLength(3);
  });

  it('returns every visible item when not paged', async () => {
    const result = await service.findAll();
    expect(keysOf(result.data).sort()).toEqual([...VISIBLE].sort());
    expect(result.page).toBeUndefined();
  });

  it.each([
    ['Accra, default 10 km', ACCRA, undefined],
    ['Accra, 300 km', ACCRA, 300],
    ['Accra, 1 km', ACCRA, 1],
    ['0,0, 1 km', PLACES.nullIsland, 1],
    // The longitude range would wrap, so only latitude is boxed.
    ['across the antimeridian', { lat: -17.75, lng: -179.95 }, 50],
    ['near the north pole', { lat: 89.99, lng: 0 }, 50],
    ['more than a quarter of the globe', ACCRA, 15000],
    ['half the globe', ACCRA, 20016],
  ])('matches the JS haversine from %s', async (_, from, radius) => {
    const result = await service.findAll({
      lat: from.lat,
      lng: from.lng,
      radius,
    });
    const expected = VISIBLE.filter((key) => {
      const at = coords[key];
      // Items without coordinates are always kept.
      return (
        !at || haversineKm(from.lat, from.lng, at.lat, at.lng) <= (radius ?? 10)
      );
    });
    expect(keysOf(result.data).sort()).toEqual(expected.sort());
    expect(result.total).toBe(expected.length);
  });

  it('keeps the radius when paging', async () => {
    const result = await service.findAll({ ...ACCRA, page: 1, limit: 2 });
    expect(result.total).toBe(3); // accraChair, noLocation, osuLamp
    expect(keysOf(result.data)).toEqual(['accraChair', 'noLocation']);
  });

  it.each([
    [
      'a top-level category and its subcategories',
      'parent',
      ['accraChair', 'kumasiTable', 'nullIsland'],
    ],
    ['a subcategory alone', 'sub', ['accraChair', 'nullIsland']],
    ['a category with no children', 'other', ['noLocation']],
  ])('filters by %s', async (_, category, expected) => {
    const result = await service.findAll({ category_id: ids[category] });
    expect(keysOf(result.data).sort()).toEqual([...expected].sort());
  });

  it('counts each sharer’s live listings, hidden ones included', async () => {
    const result = await service.findAll();
    const countFor = (key: string) =>
      result.data.find(({ id }) => id === ids[key])!.user!.items_count;
    // Alice: accraChair, noLocation, osuLamp, hidden (deleted is not counted).
    expect(countFor('accraChair')).toBe(4);
    expect(countFor('kumasiTable')).toBe(4);
  });

  it('shows the owner their hidden listing only in their own list', async () => {
    const own = await service.findAll({
      user_id: ids.alice,
      viewer_id: ids.alice,
    });
    const other = await service.findAll({
      user_id: ids.alice,
      viewer_id: ids.bob,
    });
    expect(keysOf(own.data)).toContain('hidden');
    expect(keysOf(other.data)).not.toContain('hidden');
  });

  it('searches ignoring case and accents, with wildcards literal', async () => {
    expect(keysOf((await service.findAll({ query: 'CREME' })).data)).toEqual([
      'osuLamp',
    ]);
    expect((await service.findAll({ query: '%' })).total).toBe(0);
    expect((await service.findAll({ query: "' OR '1'='1" })).total).toBe(0);
  });
});
