import { Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, SelectQueryBuilder } from 'typeorm';
import {
  ItemRequestEntity,
  RequestStatus,
} from '../item-request/entities/item-request.entity';
import { MessageEntity, SystemEvent } from '../chat/entities/message.entity';
import { AppError } from '../common/app-error';
import { escapeLike } from '../common/text-fold';
import { toUserRef } from './admin-views';
import { AdminRequestQueryDto } from './dto/admin-query.dto';

/** The status each request system message records the request moving to. */
const EVENT_STATUS: Record<SystemEvent, RequestStatus> = {
  [SystemEvent.ITEM_REQUESTED]: RequestStatus.PENDING,
  [SystemEvent.REQUEST_CONFIRMED]: RequestStatus.CONFIRMED,
  [SystemEvent.REQUEST_CANCELLED]: RequestStatus.CANCELLED,
  [SystemEvent.PICKUP_CONFIRMED]: RequestStatus.COMPLETED,
};

type Queue = { position: number; queue_length: number };

/**
 * Every request across the platform, as staff see them. Read-only: requests
 * are the two parties' to change, and closing them happens through the
 * listing or the account.
 */
@Injectable()
export class AdminRequestsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(query: AdminRequestQueryDto) {
    const { page = 1, limit = 20 } = query;
    const qb = this.baseQuery();

    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    if (query.item_id) {
      qb.andWhere('r.item_id = :itemId', { itemId: query.item_id });
    }
    if (query.requester_id) {
      qb.andWhere('r.requester_id = :requesterId', {
        requesterId: query.requester_id,
      });
    }
    if (query.owner_id) {
      qb.andWhere('r.owner_id = :ownerId', { ownerId: query.owner_id });
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('item.title ILIKE :search');
          for (const party of ['requester', 'owner']) {
            w.orWhere(
              `concat_ws(' ', ${party}.first_name, ${party}.last_name) ILIKE :search`,
            ).orWhere(`${party}.email ILIKE :search`);
          }
        }),
        { search: `%${escapeLike(search)}%` },
      );
    }
    if (query.created_from) {
      qb.andWhere('r.created_at >= :from', {
        from: new Date(query.created_from),
      });
    }
    if (query.created_to) {
      qb.andWhere('r.created_at < :to', { to: new Date(query.created_to) });
    }

    // skip/take rather than offset/limit, so the images join doesn't
    // multiply rows within a page.
    const [rows, total] = await qb
      .orderBy('r.created_at', query.order ?? 'DESC')
      .addOrderBy('r.id', query.order ?? 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const queues = await this.queuePositions(rows);
    return {
      message: 'Requests retrieved successfully',
      data: rows.map((r) => toAdminRequest(r, queues.get(r.id))),
      total,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  /**
   * One request with its status history and the listing's whole queue, so
   * staff can see where it stood and who was picked.
   */
  async detail(requestId: string) {
    const request = await this.baseQuery()
      .where('r.id = :requestId', { requestId })
      .getOne();
    if (!request) {
      throw new AppError(new NotFoundException('Request not found'));
    }

    const [queue, messages] = await Promise.all([
      this.dataSource.getRepository(ItemRequestEntity).find({
        where: { item_id: request.item_id },
        relations: ['requester'],
        order: { created_at: 'ASC', id: 'ASC' },
      }),
      this.dataSource
        .getRepository(MessageEntity)
        .createQueryBuilder('m')
        .select(['m.system_event', 'm.sender_id', 'm.created_at'])
        // Each pair has one conversation (UQ_CONVERSATIONS_PAIR, stored
        // smaller id first), so this reaches only the two parties' thread
        // through its index before any metadata is read.
        .where(
          `m.conversation_id = (
             SELECT c.id FROM conversations c
              WHERE c.user_a_id = LEAST(:requesterId::uuid, :ownerId::uuid)
                AND c.user_b_id = GREATEST(:requesterId::uuid, :ownerId::uuid)
           )`,
          { requesterId: request.requester_id, ownerId: request.owner_id },
        )
        .andWhere('m.system_event IS NOT NULL')
        .andWhere("m.metadata ->> 'request_id' = :requestId", { requestId })
        .orderBy('m.created_at', 'ASC')
        .getMany(),
    ]);

    const position = queue.findIndex((q) => q.id === request.id) + 1;
    return {
      message: 'Request retrieved successfully',
      data: {
        ...toAdminRequest(request, {
          position,
          queue_length: queue.length,
        }),
        history: statusHistory(request, messages),
        queue: queue.map((q, i) => ({
          id: q.id,
          position: i + 1,
          status: q.status,
          is_selected: isSelected(q.status),
          requester: toUserRef(q.requester),
          created_at: q.created_at,
        })),
      },
      state: true,
      statusCode: 200,
    };
  }

  private baseQuery(): SelectQueryBuilder<ItemRequestEntity> {
    return this.dataSource
      .getRepository(ItemRequestEntity)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.item', 'item')
      .leftJoinAndSelect('item.images', 'images')
      .leftJoinAndSelect('r.requester', 'requester')
      .leftJoinAndSelect('r.owner', 'owner')
      .leftJoinAndSelect('r.cancelledByUser', 'cancelledBy');
  }

  /** Each request's place in its listing's queue, in the order they came in. */
  private async queuePositions(rows: ItemRequestEntity[]) {
    const queues = new Map<string, Queue>();
    if (!rows.length) return queues;
    const ranked = await this.dataSource.query<
      { id: string; position: string; queue_length: string }[]
    >(
      `SELECT id, position, queue_length FROM (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY created_at, id) AS position,
                COUNT(*) OVER (PARTITION BY item_id) AS queue_length
           FROM item_requests
          WHERE item_id = ANY($1::uuid[])
       ) ranked
       WHERE id = ANY($2::uuid[])`,
      [[...new Set(rows.map((r) => r.item_id))], rows.map((r) => r.id)],
    );
    for (const row of ranked) {
      queues.set(row.id, {
        position: Number(row.position),
        queue_length: Number(row.queue_length),
      });
    }
    return queues;
  }
}

// The sharer confirming a request is what selects its requester.
function isSelected(status: RequestStatus) {
  return [RequestStatus.CONFIRMED, RequestStatus.COMPLETED].includes(status);
}

export function toAdminRequest(r: ItemRequestEntity, queue?: Queue) {
  const image =
    (r.item?.images ?? [])
      .filter((i) => !i.is_deleted)
      .sort(
        (a, b) =>
          Number(b.is_primary) - Number(a.is_primary) ||
          (a.display_order ?? 0) - (b.display_order ?? 0),
      )[0] ?? null;
  return {
    id: r.id,
    status: r.status,
    is_selected: isSelected(r.status),
    position: queue?.position ?? null,
    queue_length: queue?.queue_length ?? null,
    item: r.item
      ? {
          id: r.item.id,
          title: r.item.title,
          status: r.item.status,
          moderation_status: r.item.moderation_status,
          is_deleted: r.item.is_deleted,
          image_url: image?.cloudinary_secure_url ?? null,
        }
      : null,
    requester: toUserRef(r.requester),
    owner: toUserRef(r.owner),
    pickup_date: r.pickup_date,
    is_picked_up: r.is_picked_up,
    picked_up_at: r.picked_up_at,
    cancelled_at: r.cancelled_at,
    cancelled_by: toUserRef(r.cancelledByUser),
    cancellation_reason: r.cancellation_reason,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export type AdminRequest = ReturnType<typeof toAdminRequest>;

/**
 * The request's status changes, oldest first. Taken from the system messages
 * each change posts into the two users' chat; requests closed in bulk (a
 * listing or account removed) post none, so those, and anything whose
 * message failed to send, fall back to the request's own timestamps.
 *
 * The request has no confirmed_at, so a confirmation whose message is
 * missing appears with `at: null` when the request is (or was) confirmed.
 * One that was later cancelled leaves no trace and can't be recovered.
 */
export function statusHistory(
  r: ItemRequestEntity,
  messages: Pick<MessageEntity, 'system_event' | 'sender_id' | 'created_at'>[],
) {
  const party = (id: string | null) =>
    id === r.requester_id
      ? toUserRef(r.requester)
      : id === r.owner_id
        ? toUserRef(r.owner)
        : null;

  const events: {
    status: RequestStatus;
    at: Date | null;
    actor: ReturnType<typeof toUserRef>;
    note: string | null;
    /** Where an event with no recorded time sorts. */
    sortAt: Date;
  }[] = messages
    .filter((m) => m.system_event && EVENT_STATUS[m.system_event])
    .map((m) => ({
      status: EVENT_STATUS[m.system_event!],
      at: m.created_at,
      actor: party(m.sender_id),
      note: null,
      sortAt: m.created_at,
    }));

  const has = (status: RequestStatus) =>
    events.some((e) => e.status === status);
  if (!has(RequestStatus.PENDING)) {
    events.push({
      status: RequestStatus.PENDING,
      at: r.created_at,
      actor: toUserRef(r.requester),
      note: null,
      sortAt: r.created_at,
    });
  }
  if (r.cancelled_at && !has(RequestStatus.CANCELLED)) {
    events.push({
      status: RequestStatus.CANCELLED,
      at: r.cancelled_at,
      actor: toUserRef(r.cancelledByUser) ?? party(r.cancelled_by),
      note: null,
      sortAt: r.cancelled_at,
    });
  }
  // The requester confirms the pickup (see ItemRequestService.confirmPickup).
  if (r.picked_up_at && !has(RequestStatus.COMPLETED)) {
    events.push({
      status: RequestStatus.COMPLETED,
      at: r.picked_up_at,
      actor: toUserRef(r.requester),
      note: null,
      sortAt: r.picked_up_at,
    });
  }
  const confirmed = isSelected(r.status) || !!r.picked_up_at || r.is_picked_up;
  if (confirmed && !has(RequestStatus.CONFIRMED)) {
    const completedAt = events.find(
      (e) => e.status === RequestStatus.COMPLETED,
    )?.sortAt;
    events.push({
      status: RequestStatus.CONFIRMED,
      at: null,
      // Only the sharer can confirm a request.
      actor: toUserRef(r.owner),
      note: null,
      // Just before the pickup if there was one; otherwise the last change
      // to a still-confirmed request is most likely its confirmation.
      sortAt: completedAt ? new Date(completedAt.getTime() - 1) : r.updated_at,
    });
  }
  if (r.status === RequestStatus.EXPIRED && !has(RequestStatus.EXPIRED)) {
    events.push({
      status: RequestStatus.EXPIRED,
      at: r.updated_at,
      actor: null,
      note: null,
      sortAt: r.updated_at,
    });
  }

  // The reason belongs on the latest cancellation, which is the one it was
  // recorded with.
  const cancelled = events.filter((e) => e.status === RequestStatus.CANCELLED);
  if (cancelled.length && r.cancellation_reason) {
    cancelled[cancelled.length - 1].note = r.cancellation_reason;
  }

  return events
    .sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime())
    .map(({ status, at, actor, note }) => ({ status, at, actor, note }));
}
