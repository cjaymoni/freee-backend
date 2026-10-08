import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { OsmPlacesService } from './osm-places.service';

const node = (name: string, place: string, population?: string) => ({
  type: 'node',
  lat: 5.56,
  lon: -0.18,
  tags: { name, place, ...(population ? { population } : {}) },
});

describe('OsmPlacesService', () => {
  let service: OsmPlacesService;
  let store: Map<string, unknown>;
  let fetchMock: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;

  function answer(elements: unknown[], status = 200) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ elements }), { status }),
    );
  }

  beforeEach(() => {
    store = new Map();
    const cache = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve(value);
      }),
    } as unknown as Cache;
    const config = { get: () => undefined } as unknown as ConfigService;
    service = new OsmPlacesService(config, cache);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('asks Overpass for the named places in the state by its ISO code', async () => {
    answer([]);

    await service.getPlaces('GH', 'aa');

    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('data')).toContain('area["ISO3166-2"="GH-AA"]');
  });

  it('sizes places by population, or else by kind, largest kinds first', async () => {
    answer([
      node('Osu', 'suburb'),
      node('Tema', 'city', '161,612'),
      node('Kasoa', 'town'),
    ]);

    const places = await service.getPlaces('GH', 'AA');

    expect(places).toEqual([
      { name: 'Tema', latitude: 5.56, longitude: -0.18, max_radius_km: 5 },
      { name: 'Kasoa', latitude: 5.56, longitude: -0.18, max_radius_km: 5 },
      { name: 'Osu', latitude: 5.56, longitude: -0.18, max_radius_km: 3 },
    ]);
  });

  it('serves a state from the cache after the first fetch', async () => {
    answer([node('Osu', 'suburb')]);

    await service.getPlaces('GH', 'AA');
    const places = await service.getPlaces('GH', 'AA');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(places).toHaveLength(1);
  });

  it('answers null when Overpass is slow and caches its answer later', async () => {
    let finish: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    await expect(service.getPlaces('GH', 'AA', 10)).resolves.toBeNull();

    finish(new Response(JSON.stringify({ elements: [node('Osu', 'suburb')] })));
    await new Promise((resolve) => setImmediate(resolve));
    await expect(service.getPlaces('GH', 'AA')).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers null after a failure and holds off retrying', async () => {
    answer([], 504);

    await expect(service.getPlaces('GH', 'AA')).resolves.toBeNull();
    await expect(service.getPlaces('GH', 'AA')).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
