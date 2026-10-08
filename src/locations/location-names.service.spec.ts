import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { LocationEntity } from '../user/entities/location.entity';
import { LocationNamesService, toNames } from './location-names.service';

const osu = {
  display_name:
    'Yeboah Duncan Street, Osu, Ringway Estates, La, Accra, Greater Accra Region, Ghana',
  address: {
    road: 'Yeboah Duncan Street',
    suburb: 'Osu',
    town: 'La',
    city: 'Accra',
    state: 'Greater Accra Region',
    country: 'Ghana',
    country_code: 'gh',
  },
};

describe('toNames', () => {
  it('maps a Nominatim address onto the location columns', () => {
    expect(toNames(osu.address, osu.display_name)).toEqual({
      country_code: 'GHA',
      country_name: 'Ghana',
      region: 'Greater Accra Region',
      city: 'Accra',
      area: 'Osu',
      address: osu.display_name,
    });
  });

  it('treats a lone village as the city, not also the area', () => {
    const names = toNames({ village: 'Kokrobite', state: 'Greater Accra' });

    expect(names.city).toBe('Kokrobite');
    expect(names.area).toBeNull();
  });
});

describe('LocationNamesService', () => {
  let service: LocationNamesService;
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let fetchMock: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'loc-1',
        latitude: '5.56020000',
        longitude: '-0.18240000',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    service = new LocationNamesService(
      { get: () => undefined } as unknown as ConfigService,
      repo as unknown as Repository<LocationEntity>,
    );
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('names the location from its coordinates', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(osu)));

    await expect(service.fill('loc-1')).resolves.toBe(true);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe('5.5602');
    expect(repo.update).toHaveBeenCalledWith(
      'loc-1',
      expect.objectContaining({ city: 'Accra', area: 'Osu' }),
    );
  });

  it('leaves the location alone when Nominatim fails', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));

    await expect(service.fill('loc-1')).resolves.toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('skips a location without coordinates', async () => {
    repo.findOne.mockResolvedValue({ id: 'loc-1', latitude: null });

    await service.fill('loc-1');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
