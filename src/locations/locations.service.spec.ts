import { NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { CountryWithStatesDto } from './dto/location-directory.dto';

describe('LocationsService', () => {
  let service: LocationsService;

  beforeEach(() => {
    service = new LocationsService();
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

  it('lists the cities of a state, whatever the case of the codes', () => {
    const { data } = service.getCities('gha', 'aa');

    const accra = data.find((city) => city.name === 'Accra');
    expect(accra?.latitude).toEqual(expect.any(Number));
  });

  it('gives every level a max radius sized to the place', () => {
    const ghana = service
      .getCountries()
      .data.find((country) => country.code === 'GH');
    const accraRegion = service
      .getStates('GH')
      .data.find((state) => state.code === 'AA');
    const cities = service.getCities('GH', 'AA').data;
    const city = (name: string) => cities.find((c) => c.name === name);

    expect(ghana?.max_radius_km).toBeGreaterThan(300);
    expect(ghana?.max_radius_km).toBeLessThan(500);
    expect(accraRegion?.max_radius_km).toBeGreaterThan(20);
    expect(accraRegion?.max_radius_km).toBeLessThan(ghana!.max_radius_km!);
    // Accra is a city of millions, Tema of about 150,000.
    expect(city('Accra')?.max_radius_km).toBeGreaterThan(10);
    expect(city('Tema')?.max_radius_km).toBeLessThan(
      city('Accra')!.max_radius_km,
    );
    for (const { max_radius_km } of cities) {
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

  it('rejects unknown countries and states', () => {
    expect(() => service.getStates('ZZZ')).toThrow(NotFoundException);
    expect(() => service.getStates('ZZ')).toThrow(NotFoundException);
    expect(() => service.getCities('GH', 'NOPE')).toThrow(NotFoundException);
  });
});
