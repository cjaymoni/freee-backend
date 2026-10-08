import { NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CityDto, CountryWithStatesDto } from './dto/location-directory.dto';
import { OsmPlacesService } from './osm-places.service';

describe('LocationsService', () => {
  let service: LocationsService;
  let osmPlaces: CityDto[] | null;
  let getPlaces: jest.Mock;

  const cities = async (country: string, state: string) =>
    (await service.getCities(country, state)).response.data;

  beforeEach(() => {
    osmPlaces = [];
    getPlaces = jest.fn(() => Promise.resolve(osmPlaces));
    service = new LocationsService({
      getPlaces,
    } as unknown as OsmPlacesService);
  });

  it('lists countries with both alpha-2 and alpha-3 codes', () => {
    const { data } = service.getCountries();

    expect(data.length).toBeGreaterThan(200);
    expect(data).toContainEqual(
      expect.objectContaining({ code: 'GH', code3: 'GHA', name: 'Ghana' }),
    );
    expect(data).toContainEqual(
      expect.objectContaining({ code: 'US', code3: 'USA' }),
    );
  });

  it.each(['GH', 'GHA', 'gh', 'gha', ' GHA '])(
    'finds the states of Ghana from %p',
    (code) => {
      const { data } = service.getStates(code);

      expect(data).toContainEqual(
        expect.objectContaining({ code: 'AA', name: 'Greater Accra' }),
      );
    },
  );

  it('lists the cities of a state, whatever the case of the codes', async () => {
    const data = await cities('gha', 'aa');

    const accra = data.find((city) => city.name === 'Accra');
    expect(accra?.latitude).toEqual(expect.any(Number));
  });

  it('gives every level a max radius sized to the place', async () => {
    const ghana = service
      .getCountries()
      .data.find((country) => country.code === 'GH');
    const accraRegion = service
      .getStates('GH')
      .data.find((state) => state.code === 'AA');
    const accraCities = await cities('GH', 'AA');
    const city = (name: string) => accraCities.find((c) => c.name === name);

    expect(ghana?.max_radius_km).toBeGreaterThan(300);
    expect(ghana?.max_radius_km).toBeLessThan(500);
    expect(accraRegion?.max_radius_km).toBeGreaterThan(20);
    expect(accraRegion?.max_radius_km).toBeLessThan(ghana!.max_radius_km!);
    // Accra is a city of millions, Tema of about 150,000.
    expect(city('Accra')?.max_radius_km).toBeGreaterThan(10);
    expect(city('Tema')?.max_radius_km).toBeLessThan(
      city('Accra')!.max_radius_km,
    );
    for (const { max_radius_km } of accraCities) {
      expect(max_radius_km).toBeGreaterThanOrEqual(3);
      expect(max_radius_km).toBeLessThanOrEqual(50);
    }
  });

  it('keeps overseas territories from stretching a country', () => {
    const uk = service
      .getCountries()
      .data.find((country) => country.code === 'GB');

    expect(uk?.max_radius_km).toBeLessThan(1000);
  });

  it('drops state centroids the package placed outside the country', () => {
    // country-state-city puts Fiji's Ba province in Oklahoma.
    const ba = service
      .getStates('FJ')
      .data.find((state) => state.code === '01');

    expect(ba).toMatchObject({
      latitude: null,
      longitude: null,
      max_radius_km: null,
    });
  });

  it('nests states in countries only when asked to', () => {
    const plain = service.getCountries().data;
    const nested = service.getCountries(true).data;

    expect(plain[0]).not.toHaveProperty('states');
    const ghana = nested.find((country) => country.code === 'GH') as
      | CountryWithStatesDto
      | undefined;
    expect(ghana?.states).toContainEqual(
      expect.objectContaining({ code: 'AA', name: 'Greater Accra' }),
    );
  });

  it('rejects unknown countries and states', async () => {
    expect(() => service.getStates('ZZZ')).toThrow(NotFoundException);
    expect(() => service.getStates('ZZ')).toThrow(NotFoundException);
    await expect(service.getCities('GH', 'NOPE')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('adds the OpenStreetMap places of the state, sorted by name', async () => {
    osmPlaces = [
      { name: 'Osu', latitude: 5.56, longitude: -0.18, max_radius_km: 3 },
      { name: 'accra', latitude: 5.6, longitude: -0.2, max_radius_km: 10 },
    ];

    const { response, complete } = await service.getCities('GHA', 'aa');
    const names = response.data.map((city) => city.name);

    expect(getPlaces).toHaveBeenCalledWith('GH', 'AA');
    expect(complete).toBe(true);
    expect(names).toContain('Osu');
    // The dataset's Accra stays and OSM's is dropped.
    expect(names.filter((name) => name.toLowerCase() === 'accra')).toEqual([
      'Accra',
    ]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('falls back to the dataset when OpenStreetMap is not to hand', async () => {
    osmPlaces = null;

    const { response, complete } = await service.getCities('GH', 'AA');

    expect(complete).toBe(false);
    expect(response.data.map((city) => city.name)).toContain('Accra');
  });
});
