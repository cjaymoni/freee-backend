import { join } from 'path';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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
import { SavedItemEntity } from '../saved-item/entities/saved-item.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ItemViewService } from '../item-view/item-view.service';
import { SearchService } from '../search/search.service';
import {
  describeWithDatabase,
  testDatabaseFor,
} from '../common/testing/test-database';
import { NotificationService } from '../notification/notification.service';

/**
 * GET /items against a real Postgres: paging over the images join, the
 * distance SQL and category matching can only be proven on actual rows.
 * See common/testing/test-database for how to run it.
 */
const describeDb = describeWithDatabase;

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
  // 994 km from 60,0, near the widest longitude of that circle: inside the
  // exact box, outside the flat-earth one (dLat / cos lat).
  sweden: { lat: 61.2592, lng: 18.1 },
};

describeDb('ItemService.findAll on Postgres', () => {
  let ds: DataSource;
  let service: ItemService;
  const ids: Record<string, string> = {};
  const coords: Record<string, { lat: number; lng: number } | null> = {};

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url: await testDatabaseFor('items'),
      entities: [join(__dirname, '..', '**', '*.entity.ts')],
      synchronize: true,
      dropSchema: true,
      logging: false,
    }).initialize();

    const module = await Test.createTestingModule({
      providers: [
        ItemService,
        { provide: DataSource, useValue: ds },
        ...[ItemEntity, ItemImageEntity, SavedItemEntity, LocationEntity].map(
          (entity) => ({
            provide: getRepositoryToken(entity),
            useValue: ds.getRepository(entity),
          }),
        ),
        { provide: CloudinaryService, useValue: {} },
        { provide: ItemViewService, useValue: {} },
        {
          provide: SearchService,
          useValue: { record: () => Promise.resolve() },
        },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
      ],
    }).compile();
    service = module.get(ItemService);

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
    // A location row that exists but was saved without coordinates.
    locationIds.blank = (await locations.save({ label: 'Somewhere' })).id;

    // created_at is set afterwards so the order, and one tie, are exact.
    const seed: {
      key: string;
      by: UserEntity;
      place: keyof typeof PLACES | 'blank' | null;
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
      { key: 'sweden', by: bob, place: 'sweden', images: 0, minutesAgo: 9 },
      {
        key: 'blankCoords',
        by: alice,
        place: 'blank',
        images: 0,
        minutesAgo: 10,
      },
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
      coords[row.key] =
        row.place && row.place !== 'blank' ? PLACES[row.place] : null;
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
    'sweden',
    'blankCoords',
  ];

  it('walks every visible item once, newest first, across pages', async () => {
    const seen: string[] = [];
    let total = 0;
    for (let page = 1; page <= 5; page++) {
      const result = await service.findAll({ page, limit: 2 });
      total = result.total!;
      seen.push(...(keysOf(result.data) as string[]));
    }

    expect(total).toBe(9);
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
      'sweden',
      'blankCoords',
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
    ['Accra, 10 km', ACCRA, 10],
    ['Accra, 300 km', ACCRA, 300],
    ['Accra, 1 km', ACCRA, 1],
    ['0,0, 1 km', PLACES.nullIsland, 1],
    // The longitude range would wrap, so only latitude is boxed.
    ['across the antimeridian', { lat: -17.75, lng: -179.95 }, 50],
    ['near the north pole', { lat: 89.99, lng: 0 }, 50],
    ['more than a quarter of the globe', ACCRA, 15000],
    ['half the globe', ACCRA, 20016],
    ['high latitude, at the longitude edge', { lat: 60, lng: 0 }, 1000],
  ])('matches the JS haversine from %s', async (_, from, radius) => {
    const result = await service.findAll({
      lat: from.lat,
      lng: from.lng,
      radius,
    });
    const expected = VISIBLE.filter((key) => {
      const at = coords[key];
      // Items without coordinates (no location, or a blank one) are kept.
      return !at || haversineKm(from.lat, from.lng, at.lat, at.lng) <= radius;
    });
    expect(keysOf(result.data).sort()).toEqual(expected.sort());
    expect(result.total).toBe(expected.length);
  });

  it('keeps the radius when paging', async () => {
    const result = await service.findAll({
      ...ACCRA,
      radius: 10,
      page: 1,
      limit: 2,
    });
    expect(result.total).toBe(4); // accraChair, noLocation, osuLamp, blankCoords
    expect(keysOf(result.data)).toEqual(['accraChair', 'osuLamp']);
  });

  // Located items nearest first, then those without coordinates (newest
  // first: noLocation, then blankCoords).
  const BY_DISTANCE_FROM_ACCRA = () =>
    VISIBLE.filter((key) => coords[key])
      .sort(
        (a, b) =>
          haversineKm(ACCRA.lat, ACCRA.lng, coords[a]!.lat, coords[a]!.lng) -
          haversineKm(ACCRA.lat, ACCRA.lng, coords[b]!.lat, coords[b]!.lng),
      )
      .concat(['noLocation', 'blankCoords']);

  it('returns every item, nearest first, when given a location', async () => {
    const result = await service.findAll(ACCRA);
    expect(result.total).toBe(VISIBLE.length);
    expect(keysOf(result.data)).toEqual(BY_DISTANCE_FROM_ACCRA());
  });

  it('keeps the distance order across pages', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const result = await service.findAll({ ...ACCRA, page, limit: 2 });
      seen.push(...(keysOf(result.data) as string[]));
    }
    expect(seen).toEqual(BY_DISTANCE_FROM_ACCRA());
  });

  describe('with featured items', () => {
    beforeAll(() =>
      ds.query('UPDATE items SET is_featured = true WHERE id = ANY($1)', [
        [ids.blankCoords, ids.noLocation, ids.sweden],
      ]),
    );
    afterAll(() => ds.query('UPDATE items SET is_featured = false'));

    it('ranks by distance before featured', async () => {
      // Featured Sweden stays behind every nearer item, and the featured
      // coordinate-less items stay after every located one.
      const result = await service.findAll({ ...ACCRA, page: 1, limit: 20 });
      expect(keysOf(result.data)).toEqual(BY_DISTANCE_FROM_ACCRA());
    });

    it('puts featured items first among equally near ones', async () => {
      await ds.query('UPDATE items SET is_featured = false WHERE id = $1', [
        ids.noLocation,
      ]);
      try {
        const result = await service.findAll(ACCRA);
        expect(keysOf(result.data).slice(-2)).toEqual([
          'blankCoords',
          'noLocation',
        ]);
      } finally {
        await ds.query('UPDATE items SET is_featured = true WHERE id = $1', [
          ids.noLocation,
        ]);
      }
    });

    it('puts featured items first when no location is sent', async () => {
      const result = await service.findAll({ page: 1, limit: 3 });
      expect(keysOf(result.data)).toEqual([
        'noLocation',
        'sweden',
        'blankCoords',
      ]);
    });

    it('ignores a feature that has ended', async () => {
      await ds.query(
        "UPDATE items SET featured_until = now() - interval '1 day' WHERE id = $1",
        [ids.noLocation],
      );
      try {
        const result = await service.findAll({ page: 1, limit: 2 });
        expect(keysOf(result.data)).toEqual(['sweden', 'blankCoords']);
      } finally {
        await ds.query('UPDATE items SET featured_until = NULL WHERE id = $1', [
          ids.noLocation,
        ]);
      }
    });
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
    // Alice: accraChair, noLocation, osuLamp, hidden, blankCoords; her
    // deleted listing is not counted. Bob: the other five.
    expect(countFor('accraChair')).toBe(5);
    expect(countFor('kumasiTable')).toBe(5);
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
