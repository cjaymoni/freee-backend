import { NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';

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

  it('rejects unknown countries and states', () => {
    expect(() => service.getStates('ZZZ')).toThrow(NotFoundException);
    expect(() => service.getStates('ZZ')).toThrow(NotFoundException);
    expect(() => service.getCities('GH', 'NOPE')).toThrow(NotFoundException);
  });
});
