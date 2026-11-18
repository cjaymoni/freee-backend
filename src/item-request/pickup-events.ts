import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { ChatEvents } from '../chat/chat.constants';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';

/** Why a pending pickup confirmation stopped being pending. */
export type PickupConfirmationOutcome = 'confirmed' | 'declined' | 'cancelled';

/**
 * Sent with {@link ChatEvents.PICKUP_CONFIRMATION_REQUESTED} to the party who
 * has to answer; enough for the app to raise the sheet and fetch the rest.
 */
export interface PickupConfirmationRequestedPayload {
  request_id: string;
  item_id: string;
  item_title: string | null;
  marked_by: string;
  marked_at: Date;
}

/** Sent with {@link ChatEvents.PICKUP_CONFIRMATION_RESOLVED} to both parties. */
export interface PickupConfirmationResolvedPayload {
  request_id: string;
  outcome: PickupConfirmationOutcome;
}

/** The fields that decide who, if anyone, still has to confirm a pickup. */
export type PickupMarkState = Pick<
  ItemRequestEntity,
  'status' | 'owner_id' | 'requester_id' | 'pickup_marked_by'
>;

/** Enough of a request to tell both its parties about it. */
export type PickupParties = Pick<
  ItemRequestEntity,
  'id' | 'owner_id' | 'requester_id'
>;

/**
 * The party who still has to answer a pickup the other one marked, or null
 * when nothing is waiting.
 */
export function partyAwaitingPickupConfirmation(
  request: PickupMarkState,
): string | null {
  if (request.status !== RequestStatus.CONFIRMED || !request.pickup_marked_by) {
    return null;
  }
  return request.pickup_marked_by === request.owner_id
    ? request.requester_id
    : request.owner_id;
}

/**
 * Tell both parties of each request that its pending confirmation is over,
 * so the sheet closes and the marker's "waiting" state clears on every
 * device. Call after the transaction that settled it has committed.
 */
export function emitPickupResolved(
  realtime: ChatRealtimeService,
  requests: PickupParties[],
  outcome: PickupConfirmationOutcome,
): void {
  for (const request of requests) {
    const payload: PickupConfirmationResolvedPayload = {
      request_id: request.id,
      outcome,
    };
    realtime.emitToUsers(
      [request.owner_id, request.requester_id],
      ChatEvents.PICKUP_CONFIRMATION_RESOLVED,
      payload,
    );
  }
}
