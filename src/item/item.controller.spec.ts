import { UserActivityService } from '../audit/user-activity.service';
import { ItemController } from './item.controller';
import { ItemService } from './item.service';

describe('ItemController.findAll', () => {
  const findAll = jest.fn().mockResolvedValue({ state: true });
  const controller = new ItemController(
    { findAll } as unknown as ItemService,
    {} as UserActivityService,
  );

  type Query = {
    is_featured?: string;
    is_free?: string;
    lat?: string;
    lng?: string;
    radius?: string;
  };
  const list = (q: Query) =>
    controller.findAll(
      undefined,
      undefined,
      undefined,
      undefined,
      q.is_featured,
      q.is_free,
      q.lat,
      q.lng,
      q.radius,
    );

  afterEach(() => findAll.mockClear());

  it.each([
    ['true', true],
    ['false', false],
  ])('reads is_free=%s as %s', async (value, expected) => {
    await list({ is_free: value });
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ is_free: expected }),
    );
  });

  it.each(['1', '0', 'yes', ''])(
    'refuses is_free=%p instead of reading it as false',
    async (value) => {
      await expect(list({ is_free: value })).rejects.toThrow(
        'is_free must be true or false',
      );
      await expect(list({ is_featured: value })).rejects.toThrow(
        'is_featured must be true or false',
      );
    },
  );

  it('passes coordinates and radius as numbers, 0 included', async () => {
    await list({ lat: '0', lng: '-0.187', radius: '2.5' });
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 0, lng: -0.187, radius: 2.5 }),
    );
  });

  it.each([
    [{ lat: 'abc', lng: '1' }, 'lat must be a number between -90 and 90'],
    [{ lat: '', lng: '' }, 'lat must be a number between -90 and 90'],
    [{ lat: '91', lng: '1' }, 'lat must be a number between -90 and 90'],
    [{ lat: '1', lng: '181' }, 'lng must be a number between -180 and 180'],
    [{ lat: '1', lng: '1', radius: '0' }, 'radius must be a number of km'],
    [{ lat: '1', lng: '1', radius: '-5' }, 'radius must be a number of km'],
    [{ lat: '1', lng: '1', radius: 'far' }, 'radius must be a number of km'],
    [{ lat: '1' }, 'lat and lng must be sent together'],
    [{ lng: '1' }, 'lat and lng must be sent together'],
  ])('refuses %j', async (query, message) => {
    await expect(list(query)).rejects.toThrow(message);
    expect(findAll).not.toHaveBeenCalled();
  });
});
