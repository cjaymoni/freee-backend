import { EntityManager } from 'typeorm';
import { closeActiveRequests } from './close-active-requests';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { ItemEntity, ItemStatus } from '../item/entities/item.entity';

describe('closeActiveRequests', () => {
  const pending = {
    id: 'r1',
    item_id: 'item-1',
    requester_id: 'a',
    status: RequestStatus.PENDING,
  };
  const confirmed = {
    id: 'r2',
    item_id: 'item-2',
    requester_id: 'a',
    status: RequestStatus.CONFIRMED,
  };
  let manager: { find: jest.Mock; update: jest.Mock; query: jest.Mock };

  beforeEach(() => {
    manager = {
      find: jest.fn().mockResolvedValue([pending, confirmed]),
      update: jest.fn(),
      query: jest.fn(),
    };
  });

  const run = (scope: { itemIds: string[] } | { userId: string }) =>
    closeActiveRequests(
      manager as unknown as EntityManager,
      scope,
      'admin',
      'Item was removed',
    );

  it('cancels every active request with the reason and actor', async () => {
    await run({ userId: 'a' });

    const [entity, criteria, patch] = manager.update.mock.calls[0] as [
      unknown,
      { id: { value: string[] } },
      Record<string, unknown>,
    ];
    expect(entity).toBe(ItemRequestEntity);
    expect(criteria.id.value).toEqual(['r1', 'r2']);
    expect(patch).toMatchObject({
      status: RequestStatus.CANCELLED,
      cancelled_by: 'admin',
      cancellation_reason: 'Item was removed',
    });
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('releases a reservation only on items that are not deleted', async () => {
    await run({ userId: 'a' });

    const release = manager.update.mock.calls.find(
      ([entity]) => entity === ItemEntity,
    ) as [unknown, Record<string, unknown>, Record<string, unknown>];
    expect(release[1]).toMatchObject({
      is_deleted: false,
      status: ItemStatus.RESERVED,
    });
    expect((release[1].id as { value: string[] }).value).toEqual(['item-2']);
    expect(release[2]).toEqual({ status: ItemStatus.AVAILABLE });
  });

  it('does nothing for an empty item list', async () => {
    await run({ itemIds: [] });
    expect(manager.find).not.toHaveBeenCalled();
  });

  it('clears pickup marks and returns the requests that had one waiting', async () => {
    const marked = {
      ...confirmed,
      owner_id: 'owner',
      pickup_marked_by: 'a',
    };
    manager.find.mockResolvedValue([pending, marked]);

    const closed = await run({ userId: 'a' });

    expect(manager.update.mock.calls[0][2]).toMatchObject({
      pickup_marked_by: null,
      pickup_marked_at: null,
      pickup_reminded_at: null,
    });
    expect(closed).toEqual([
      { id: 'r2', owner_id: 'owner', requester_id: 'a' },
    ]);
  });

  it('returns nothing when no request had a pickup waiting', async () => {
    await expect(run({ userId: 'a' })).resolves.toEqual([]);
  });
});
