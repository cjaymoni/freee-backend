import { EntityManager, In } from 'typeorm';
import { ItemEntity, ItemStatus } from '../item/entities/item.entity';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';

const ACTIVE = [RequestStatus.PENDING, RequestStatus.CONFIRMED];

/**
 * Cancel the pending and confirmed requests that can no longer be fulfilled,
 * because their item or one of the two parties was removed. Keeps the same
 * invariants as a normal cancel: the requester leaves items.requester_ids,
 * and an item reserved by a cancelled confirmed request is released - unless
 * the item itself is deleted, which must never come back as available.
 *
 * Runs in the caller's transaction so it commits with the deletion.
 */
export async function closeActiveRequests(
  manager: EntityManager,
  scope: { itemIds: string[] } | { userId: string },
  closedBy: string,
  reason: string,
): Promise<void> {
  const where =
    'itemIds' in scope
      ? scope.itemIds.length
        ? [{ item_id: In(scope.itemIds), status: In(ACTIVE) }]
        : []
      : [
          { owner_id: scope.userId, status: In(ACTIVE) },
          { requester_id: scope.userId, status: In(ACTIVE) },
        ];
  if (!where.length) return;

  const requests = await manager.find(ItemRequestEntity, { where });
  if (!requests.length) return;

  await manager.update(
    ItemRequestEntity,
    { id: In(requests.map((request) => request.id)) },
    {
      status: RequestStatus.CANCELLED,
      cancelled_at: new Date(),
      cancelled_by: closedBy,
      cancellation_reason: reason,
    },
  );

  for (const request of requests) {
    await manager.query(
      `UPDATE items SET requester_ids = array_remove(requester_ids, $1::uuid) WHERE id = $2`,
      [request.requester_id, request.item_id],
    );
  }

  const released = requests
    .filter((request) => request.status === RequestStatus.CONFIRMED)
    .map((request) => request.item_id);
  if (released.length) {
    await manager.update(
      ItemEntity,
      { id: In(released), is_deleted: false, status: ItemStatus.RESERVED },
      { status: ItemStatus.AVAILABLE },
    );
  }
}
