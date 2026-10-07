import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UserLocationService } from './user-location.service';
import { LocationEntity } from './entities/location.entity';

describe('UserLocationService', () => {
  let repository: { findOne: jest.Mock };
  let service: UserLocationService;

  beforeEach(() => {
    repository = { findOne: jest.fn() };
    service = new UserLocationService(
      repository as unknown as Repository<LocationEntity>,
    );
  });

  // A null result reaches clients as a 200 with an empty body.
  it.each([
    ['primary', () => service.findPrimaryLocation('u1')],
    ['current', () => service.findCurrentLocation('u1')],
  ])('404s when no %s location is set', async (_kind, find) => {
    repository.findOne.mockResolvedValue(null);

    await expect(find()).rejects.toThrow(NotFoundException);
  });

  it('returns the primary location when there is one', async () => {
    repository.findOne.mockResolvedValue({
      id: 'l1',
      user_id: 'u1',
      is_primary: true,
    } as LocationEntity);

    await expect(service.findPrimaryLocation('u1')).resolves.toMatchObject({
      id: 'l1',
    });
  });
});
