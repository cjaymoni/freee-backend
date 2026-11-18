import { EntityManager, In } from 'typeorm';
import { ItemEntity, ItemStatus } from '../item/entities/item.entity';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import {
  partyAwaitingPickupConfirmation,
  type PickupParties,
} from './pickup-events';

const ACTIVE = [RequestStatus.PENDING, RequestStatus.CONFIRMED];

/**
 * Cancel the pending and confirmed requests that can no longer be fulfilled,
 * because their item or one of the two parties was removed. Keeps the same
 * invariants as a normal cancel: the requester leaves items.requester_ids,
 * and an item reserved by a cancelled confirmed request is released - unless
 * the item itself is deleted, which must never come back as available.
 *
 * A pickup one party had marked is cleared with it. Those requests are
 * returned so the caller can close the other party's confirm sheet with
 * emitPickupResolved once its transaction has committed.
 *
 * Runs in the caller's transaction so it commits with the deletion.
 *
 * Lock order matches every request transition - item, then request - so it
 * can't deadlock against one: the affected items are locked first, in id
 * order, and the requests are re-read under those locks before anything is
 * written. That re-read is also what stops it cancelling a request a
 * transition completed in the meantime; the update re-checks status as well,
 * for the one writer that skips item locks (the pickup reminder job, which
 * never changes status).
 *
 * @returns the closed requests that had a pickup waiting to be confirmed.
 */
export async function closeActiveRequests(
  manager: EntityManager,
  scope: { itemIds: string[] } | { userId: string },
  closedBy: string,
  reason: string,
): Promise<PickupParties[]> {
  const where =
    'itemIds' in scope
      ? scope.itemIds.length
        ? [{ item_id: In(scope.itemIds), status: In(ACTIVE) }]
        : []
      : [
          { owner_id: scope.userId, status: In(ACTIVE) },
          { requester_id: scope.userId, status: In(ACTIVE) },
        ];
  if (!where.length) return [];

  const candidates = await manager.find(ItemRequestEntity, {
    where,
    select: { id: true, item_id: true },
  });
  if (!candidates.length) return [];

  await lockItemsInOrder(
    manager,
    candidates.map((request) => request.item_id),
  );

  // Under the item locks no transition can move these requests any more.
  const requests = await manager.find(ItemRequestEntity, { where });
  if (!requests.length) return [];

  const pendingPickups = requests
    .filter((request) => partyAwaitingPickupConfirmation(request) !== null)
    .map(({ id, owner_id, requester_id }) => ({ id, owner_id, requester_id }));

  await manager.update(
    ItemRequestEntity,
    { id: In(requests.map((request) => request.id)), status: In(ACTIVE) },
    {
      status: RequestStatus.CANCELLED,
      cancelled_at: new Date(),
      cancelled_by: closedBy,
      cancellation_reason: reason,
      pickup_marked_by: null,
      pickup_marked_at: null,
      pickup_reminded_at: null,
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

  return pendingPickups;
}

/**
 * Take the write lock on each item, in id order, so two callers locking
 * overlapping sets can't each hold one the other needs.
 */
async function lockItemsInOrder(
  manager: EntityManager,
  itemIds: string[],
): Promise<void> {
  const ordered = [...new Set(itemIds)].sort();
  await manager.query(
    'SELECT id FROM items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [ordered],
  );
}
