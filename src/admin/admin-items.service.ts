import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Brackets, DataSource, SelectQueryBuilder } from 'typeorm';
import { ItemEntity, ModerationStatus } from '../item/entities/item.entity';
import {
  ItemRequestEntity,
  RequestStatus,
} from '../item-request/entities/item-request.entity';
import { ReportedItem } from '../moderation/entities/reported-item.entity';
import { AuditEntityType } from '../audit/audit.constants';
import { AppError } from '../common/app-error';
import { ServiceResponseDto } from '../common/service-response.dto';
import { escapeLike } from '../common/text-fold';
import { AdminAuditService, StaffActor } from './admin-audit.service';
import { AdminItem, toAdminItem, toUserRef } from './admin-views';
import { AdminItemQueryDto } from './dto/admin-query.dto';

export const ITEM_HIDDEN = 'hidden';
export const ITEM_FLAGGED = 'flagged';
export const ITEM_RESTORED = 'restored';

/** Which moderation states each action may start from. */
const TRANSITIONS: Record<
  typeof ITEM_HIDDEN | typeof ITEM_FLAGGED | typeof ITEM_RESTORED,
  { from: ModerationStatus[]; to: ModerationStatus }
> = {
  [ITEM_HIDDEN]: {
    from: [ModerationStatus.VISIBLE, ModerationStatus.FLAGGED],
    to: ModerationStatus.HIDDEN,
  },
  [ITEM_FLAGGED]: {
    from: [ModerationStatus.VISIBLE],
    to: ModerationStatus.FLAGGED,
  },
  [ITEM_RESTORED]: {
    from: [ModerationStatus.HIDDEN, ModerationStatus.FLAGGED],
    to: ModerationStatus.VISIBLE,
  },
};

@Injectable()
export class AdminItemsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly adminAudit: AdminAuditService,
  ) {}

  async list(
    query: AdminItemQueryDto,
  ): Promise<ServiceResponseDto<AdminItem[]>> {
    const { page = 1, limit = 20 } = query;
    const qb = this.baseQuery();

    if (!query.include_deleted) qb.andWhere('item.is_deleted = false');

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('item.title ILIKE :search')
            .orWhere('item.description ILIKE :search'),
        ),
        { search: `%${escapeLike(search)}%` },
      );
    }
    if (query.user_id) {
      qb.andWhere('item.user_id = :userId', { userId: query.user_id });
    }
    if (query.category_id) {
      // A top-level category also matches its subcategories.
      qb.andWhere(
        '(category.id = :categoryId OR category.parent_category_id = :categoryId)',
        { categoryId: query.category_id },
      );
    }
    if (query.status) {
      qb.andWhere('item.status = :status', { status: query.status });
    }
    if (query.moderation_status) {
      qb.andWhere('item.moderation_status = :moderation', {
        moderation: query.moderation_status,
      });
    }
    if (query.city) {
      qb.andWhere('location.city ILIKE :city', {
        city: escapeLike(query.city.trim()),
      });
    }
    if (query.area) {
      qb.andWhere('location.area ILIKE :area', {
        area: escapeLike(query.area.trim()),
      });
    }
    if (query.has_requests !== undefined) {
      const exists =
        'EXISTS (SELECT 1 FROM item_requests ir WHERE ir.item_id = item.id)';
      qb.andWhere(query.has_requests ? exists : `NOT ${exists}`);
    }

    // skip/take rather than offset/limit: TypeORM then pages on distinct
    // listings, which the images join would otherwise multiply.
    const [rows, total] = await qb
      .orderBy('item.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const counts = await this.requestCounts(rows.map((r) => r.id));
    return {
      message: 'Listings retrieved successfully',
      data: rows.map((r) => toAdminItem(r, counts.get(r.id))),
      total,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  /** The listing, removed or not, with its requests in the order they came in. */
  async detail(itemId: string) {
    const item = await this.baseQuery()
      .where('item.id = :itemId', { itemId })
      .getOne();
    if (!item) throw new AppError(new NotFoundException('Listing not found'));

    const [requests, reports] = await Promise.all([
      this.dataSource.getRepository(ItemRequestEntity).find({
        where: { item_id: itemId },
        relations: ['requester'],
        order: { created_at: 'ASC' },
      }),
      this.dataSource.getRepository(ReportedItem).find({
        where: { itemId },
        relations: ['reporter'],
        order: { createdAt: 'DESC' },
      }),
    ]);
    const counts = await this.requestCounts([itemId]);

    return {
      message: 'Listing retrieved successfully',
      data: {
        ...toAdminItem(item, counts.get(itemId)),
        requests: requests.map((r, i) => ({
          id: r.id,
          position: i + 1,
          status: r.status,
          // The sharer confirming a request is what selects its requester.
          is_selected: [
            RequestStatus.CONFIRMED,
            RequestStatus.COMPLETED,
          ].includes(r.status),
          requester: toUserRef(r.requester),
          pickup_date: r.pickup_date,
          is_picked_up: r.is_picked_up,
          picked_up_at: r.picked_up_at,
          cancelled_at: r.cancelled_at,
          cancellation_reason: r.cancellation_reason,
          created_at: r.created_at,
        })),
        reports: reports.map((r) => ({
          id: r.id,
          reason: r.reason,
          status: r.status,
          priority: r.priority,
          reporter: toUserRef(r.reporter),
          created_at: r.createdAt,
        })),
      },
      state: true,
      statusCode: 200,
    };
  }

  hide(actor: StaffActor, itemId: string, reason: string, request?: Request) {
    return this.moderate(actor, itemId, ITEM_HIDDEN, reason, request);
  }

  flag(actor: StaffActor, itemId: string, reason: string, request?: Request) {
    return this.moderate(actor, itemId, ITEM_FLAGGED, reason, request);
  }

  restore(
    actor: StaffActor,
    itemId: string,
    reason?: string,
    request?: Request,
  ) {
    return this.moderate(actor, itemId, ITEM_RESTORED, reason, request);
  }

  private async moderate(
    actor: StaffActor,
    itemId: string,
    action: keyof typeof TRANSITIONS,
    reason: string | undefined,
    request?: Request,
  ) {
    const repo = this.dataSource.getRepository(ItemEntity);
    const item = await repo.findOne({
      where: { id: itemId, is_deleted: false },
    });
    if (!item) throw new AppError(new NotFoundException('Listing not found'));

    const { from, to } = TRANSITIONS[action];
    if (!from.includes(item.moderation_status)) {
      throw new AppError(
        new ConflictException(
          `A ${item.moderation_status} listing cannot be ${action}`,
        ),
      );
    }

    const moderatedAt = new Date();
    await repo.update(itemId, {
      moderation_status: to,
      moderation_reason:
        to === ModerationStatus.VISIBLE ? null : (reason ?? null),
      moderated_by: actor.userId,
      moderated_at: moderatedAt,
    });

    await this.adminAudit.record({
      actor,
      entityType: AuditEntityType.ITEMS,
      entityId: itemId,
      action,
      oldValues: { moderation_status: item.moderation_status },
      newValues: { moderation_status: to },
      reason,
      request,
    });

    return this.detail(itemId);
  }

  private baseQuery(): SelectQueryBuilder<ItemEntity> {
    return this.dataSource
      .getRepository(ItemEntity)
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.user', 'user')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.location', 'location')
      .leftJoinAndSelect('item.images', 'images');
  }

  private async requestCounts(itemIds: string[]) {
    const counts = new Map<
      string,
      { requests: number; pending_requests: number }
    >();
    if (!itemIds.length) return counts;
    const rows = await this.dataSource
      .getRepository(ItemRequestEntity)
      .createQueryBuilder('r')
      .select('r.item_id', 'item_id')
      .addSelect('COUNT(*)', 'requests')
      .addSelect(
        `COUNT(*) FILTER (WHERE r.status = '${RequestStatus.PENDING}')`,
        'pending_requests',
      )
      .where('r.item_id IN (:...itemIds)', { itemIds })
      .groupBy('r.item_id')
      .getRawMany<{
        item_id: string;
        requests: string;
        pending_requests: string;
      }>();
    for (const row of rows) {
      counts.set(row.item_id, {
        requests: Number(row.requests),
        pending_requests: Number(row.pending_requests),
      });
    }
    return counts;
  }
}
