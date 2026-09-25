import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Request } from 'express';
import { Brackets, DataSource, LessThanOrEqual } from 'typeorm';
import {
  AccountStatus,
  UserEntity,
  UserRole,
  isStaff,
} from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { ItemEntity, ItemStatus } from '../item/entities/item.entity';
import {
  ItemRequestEntity,
  RequestStatus,
} from '../item-request/entities/item-request.entity';
import { ReportedUser } from '../moderation/entities/reported-user.entity';
import { ReportedItem } from '../moderation/entities/reported-item.entity';
import { ReportStatus } from '../moderation/dto/resolve-report.dto';
import { UserActivityLogEntity } from '../audit/entities/user-activity-log.entity';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { AuditEntityType } from '../audit/audit.constants';
import { FirebaseService } from '../firebase/firebase.service';
import { AppError } from '../common/app-error';
import { ServiceResponseDto } from '../common/service-response.dto';
import { escapeLike } from '../common/text-fold';
import { UserResponseDto } from '../user/dto/user-response.dto';
import { AdminAuditService, StaffActor } from './admin-audit.service';
import { AdminUser, toAdminUser, toUserRef } from './admin-views';
import {
  AdminUserQueryDto,
  AdminUserRequestsQueryDto,
} from './dto/admin-query.dto';

export const ROLE_CHANGED = 'role_changed';
export const USER_SUSPENDED = 'suspended';
export const USER_BANNED = 'banned';
export const USER_REINSTATED = 'reinstated';

/** Reports still waiting on staff. */
const OPEN_REPORT = [ReportStatus.PENDING, ReportStatus.IN_REVIEW];

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly adminAudit: AdminAuditService,
    private readonly firebase: FirebaseService,
  ) {}

  async list(
    query: AdminUserQueryDto,
  ): Promise<ServiceResponseDto<AdminUser[]>> {
    const { page = 1, limit = 20 } = query;
    const qb = this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .where('u.is_deleted = false');

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where("concat_ws(' ', u.first_name, u.last_name) ILIKE :search")
            .orWhere('u.email ILIKE :search')
            .orWhere('u.phone_number ILIKE :search'),
        ),
        { search: `%${escapeLike(search)}%` },
      );
    }
    if (query.account_status) {
      qb.andWhere('u.account_status = :status', {
        status: query.account_status,
      });
    }
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.created_from) {
      qb.andWhere('u.created_at >= :from', {
        from: new Date(query.created_from),
      });
    }
    if (query.created_to) {
      qb.andWhere('u.created_at < :to', { to: new Date(query.created_to) });
    }

    const [users, total] = await qb
      .orderBy('u.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      message: 'Users retrieved successfully',
      data: users.map(toAdminUser),
      total,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  /** Profile plus the counts the user page opens with. */
  async detail(userId: string) {
    const user = await this.findUser(userId);
    const items = this.dataSource.getRepository(ItemEntity);
    const requests = this.dataSource.getRepository(ItemRequestEntity);

    const [
      listings,
      activeListings,
      requestsMade,
      requestsReceived,
      giveawaysCompleted,
      itemsReceived,
      reportsAgainst,
      openReportsAgainst,
    ] = await Promise.all([
      items.count({ where: { user_id: userId, is_deleted: false } }),
      items.count({
        where: {
          user_id: userId,
          is_deleted: false,
          status: ItemStatus.AVAILABLE,
        },
      }),
      requests.count({ where: { requester_id: userId } }),
      requests.count({ where: { owner_id: userId } }),
      requests.count({
        where: { owner_id: userId, status: RequestStatus.COMPLETED },
      }),
      requests.count({
        where: { requester_id: userId, status: RequestStatus.COMPLETED },
      }),
      this.dataSource
        .getRepository(ReportedUser)
        .count({ where: { reportedUserId: userId } }),
      this.dataSource
        .getRepository(ReportedUser)
        .createQueryBuilder('r')
        .where('r.reported_user_id = :userId', { userId })
        .andWhere('r.status IN (:...open)', { open: OPEN_REPORT })
        .getCount(),
    ]);

    return {
      message: 'User retrieved successfully',
      data: {
        ...toAdminUser(user),
        counts: {
          listings,
          active_listings: activeListings,
          requests_made: requestsMade,
          requests_received: requestsReceived,
          giveaways_completed: giveawaysCompleted,
          items_received: itemsReceived,
          reports_against: reportsAgainst,
          open_reports_against: openReportsAgainst,
        },
      },
      state: true,
      statusCode: 200,
    };
  }

  async listRequests(userId: string, query: AdminUserRequestsQueryDto) {
    await this.findUser(userId);
    const { page = 1, limit = 20 } = query;
    const qb = this.dataSource
      .getRepository(ItemRequestEntity)
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.item', 'item')
      .leftJoinAndSelect('r.requester', 'requester')
      .leftJoinAndSelect('r.owner', 'owner');

    if (query.direction === 'made') {
      qb.where('r.requester_id = :userId', { userId });
    } else if (query.direction === 'received') {
      qb.where('r.owner_id = :userId', { userId });
    } else {
      qb.where('(r.requester_id = :userId OR r.owner_id = :userId)', {
        userId,
      });
    }
    if (query.status)
      qb.andWhere('r.status = :status', { status: query.status });

    const [rows, total] = await qb
      .orderBy('r.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      message: 'Requests retrieved successfully',
      data: rows.map((r) => ({
        id: r.id,
        status: r.status,
        direction: r.requester_id === userId ? 'made' : 'received',
        item: r.item
          ? { id: r.item.id, title: r.item.title, status: r.item.status }
          : null,
        requester: toUserRef(r.requester),
        owner: toUserRef(r.owner),
        pickup_date: r.pickup_date,
        is_picked_up: r.is_picked_up,
        picked_up_at: r.picked_up_at,
        cancelled_at: r.cancelled_at,
        cancellation_reason: r.cancellation_reason,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      total,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  /** Reports against the user, and against their listings. */
  async listReports(userId: string) {
    await this.findUser(userId);
    const [userReports, listingReports] = await Promise.all([
      this.dataSource.getRepository(ReportedUser).find({
        where: { reportedUserId: userId },
        relations: ['reporter', 'reviewer'],
        order: { createdAt: 'DESC' },
      }),
      this.dataSource
        .getRepository(ReportedItem)
        .createQueryBuilder('r')
        .leftJoinAndSelect('r.item', 'item')
        .leftJoinAndSelect('r.reporter', 'reporter')
        .leftJoinAndSelect('r.reviewer', 'reviewer')
        .where('item.user_id = :userId', { userId })
        .orderBy('r.createdAt', 'DESC')
        .getMany(),
    ]);

    const common = (r: ReportedUser | ReportedItem) => ({
      id: r.id,
      reason: r.reason,
      description: r.description ?? null,
      status: r.status,
      priority: r.priority,
      action_taken: r.actionTaken ?? null,
      resolution_notes: r.resolutionNotes ?? null,
      reporter: toUserRef(r.reporter),
      reviewer: toUserRef(r.reviewer),
      created_at: r.createdAt,
      resolved_at: r.resolvedAt ?? null,
    });

    return {
      message: 'Reports retrieved successfully',
      data: {
        user_reports: userReports.map(common),
        listing_reports: listingReports.map((r) => ({
          ...common(r),
          item: r.item ? { id: r.item.id, title: r.item.title } : null,
        })),
      },
      state: true,
      statusCode: 200,
    };
  }

  /**
   * One timeline: what the user did in the app, what they changed through
   * the API, and what anyone (staff included) changed on their account.
   */
  async activity(userId: string, limit = 50) {
    await this.findUser(userId);
    const [activity, audits] = await Promise.all([
      this.dataSource.getRepository(UserActivityLogEntity).find({
        where: { user_id: userId },
        order: { created_at: 'DESC' },
        take: limit,
      }),
      this.dataSource
        .getRepository(AuditLogEntity)
        .createQueryBuilder('a')
        .where('a.user_id = :userId', { userId })
        .orWhere('(a.entity_type = :users AND a.entity_id = :userId)', {
          users: AuditEntityType.USERS,
          userId,
        })
        .orderBy('a.created_at', 'DESC')
        .take(limit)
        .getMany(),
    ]);

    const events = [
      ...activity.map((a) => ({
        id: a.id,
        source: 'activity' as const,
        action: a.activity_type,
        actor_id: a.user_id,
        entity_type: a.resource_type,
        entity_id: a.resource_id,
        metadata: a.metadata,
        at: a.created_at,
      })),
      ...audits.map((a) => ({
        id: a.id,
        source: 'audit' as const,
        action: a.action,
        actor_id: a.user_id,
        entity_type: a.entity_type,
        entity_id: a.entity_id,
        metadata: {
          ...(a.metadata ?? {}),
          ...(a.changed_fields && { changed_fields: a.changed_fields }),
        },
        at: a.created_at,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit);

    return {
      message: 'Activity retrieved successfully',
      data: events,
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Blocks the account everywhere but the complaint endpoints, so the user
   * can still appeal. Their sessions stay for the same reason.
   */
  async suspend(
    actor: StaffActor,
    userId: string,
    reason: string,
    until?: string,
    request?: Request,
  ) {
    const user = await this.findManageableUser(actor, userId);
    if (user.account_status === AccountStatus.BANNED) {
      throw new AppError(
        new ConflictException(
          'This account is banned; reinstate it before suspending',
        ),
      );
    }
    const suspendedUntil = until ? new Date(until) : null;
    if (suspendedUntil && suspendedUntil <= new Date()) {
      throw new AppError(
        new BadRequestException('until must be in the future'),
      );
    }

    await this.userService.setAccountState(user, {
      is_active: false,
      account_status: AccountStatus.SUSPENDED,
      status_reason: reason,
      suspended_until: suspendedUntil,
      status_changed_by: actor.userId,
    });
    await this.recordStatusChange(
      actor,
      user,
      USER_SUSPENDED,
      reason,
      request,
      {
        suspended_until: suspendedUntil,
      },
    );
    return this.detail(userId);
  }

  /** Admin only. Ends every session; banned accounts reach nothing, appeals included. */
  async ban(
    actor: StaffActor,
    userId: string,
    reason: string,
    request?: Request,
  ) {
    const user = await this.findManageableUser(actor, userId);
    if (user.account_status === AccountStatus.BANNED) {
      throw new AppError(
        new ConflictException('This account is already banned'),
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await this.userService.setAccountState(
        user,
        {
          is_active: false,
          account_status: AccountStatus.BANNED,
          status_reason: reason,
          suspended_until: null,
          status_changed_by: actor.userId,
        },
        manager,
      );
      await manager.update(
        UserSessionEntity,
        { user: { id: userId }, is_active: true },
        { is_active: false },
      );
    });
    // Outside the transaction: a Firebase outage must not undo the ban, and
    // the guard refuses banned accounts whatever token they hold.
    if (user.firebase_uid) {
      const revoked = await this.firebase.revokeRefreshTokens(
        user.firebase_uid,
      );
      if (!revoked) {
        this.logger.warn(
          `Firebase tokens not revoked for banned user ${userId}`,
        );
      }
    }
    await this.recordStatusChange(actor, user, USER_BANNED, reason, request);
    return this.detail(userId);
  }

  /** Lifts a suspension (staff) or a ban (admins only). */
  async reinstate(
    actor: StaffActor,
    userId: string,
    reason?: string,
    request?: Request,
  ) {
    const user = await this.findManageableUser(actor, userId);
    if (user.account_status === AccountStatus.ACTIVE && user.is_active) {
      throw new AppError(
        new ConflictException('This account is already active'),
      );
    }
    if (
      user.account_status === AccountStatus.BANNED &&
      actor.role !== UserRole.ADMIN
    ) {
      throw new AppError(new ForbiddenException('Only admins can lift a ban'));
    }

    await this.userService.setAccountState(user, {
      is_active: true,
      account_status: AccountStatus.ACTIVE,
      status_reason: null,
      suspended_until: null,
      status_changed_by: actor.userId,
    });
    await this.recordStatusChange(
      actor,
      user,
      USER_REINSTATED,
      reason,
      request,
    );
    return this.detail(userId);
  }

  /** Suspensions with an end date lift themselves. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async liftExpiredSuspensions(): Promise<number> {
    const expired = await this.dataSource.getRepository(UserEntity).find({
      where: {
        account_status: AccountStatus.SUSPENDED,
        suspended_until: LessThanOrEqual(new Date()),
        is_deleted: false,
      },
    });
    for (const user of expired) {
      await this.userService.setAccountState(user, {
        is_active: true,
        account_status: AccountStatus.ACTIVE,
        status_reason: null,
        suspended_until: null,
        status_changed_by: null,
      });
      await this.recordStatusChange(
        null,
        user,
        USER_REINSTATED,
        'Suspension ended',
      );
    }
    if (expired.length) {
      this.logger.log(`Lifted ${expired.length} expired suspension(s)`);
    }
    return expired.length;
  }

  async changeRole(
    actor: StaffActor,
    userId: string,
    role: UserRole,
    reason?: string,
    request?: Request,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    // Only admins reach this, and an admin can't change their own role, so
    // demoting another admin always leaves at least one (the actor).
    if (userId === actor.userId) {
      throw new AppError(
        new ForbiddenException('You cannot change your own role'),
      );
    }

    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: userId, is_deleted: false } });
    if (!user) {
      throw new AppError(new NotFoundException('User not found'));
    }
    if (user.role === role) {
      throw new AppError(
        new BadRequestException(`User already has the ${role} role`),
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const updated = await this.userService.update(userId, { role }, manager);
      // The role travels in the access token, so end every session: the user
      // signs in again and gets a token carrying the new role.
      await manager.update(
        UserSessionEntity,
        { user: { id: userId }, is_active: true },
        { is_active: false },
      );
      return updated;
    });

    await this.adminAudit.record({
      actor,
      entityType: AuditEntityType.USERS,
      entityId: userId,
      action: ROLE_CHANGED,
      oldValues: { role: user.role },
      newValues: { role },
      reason,
      request,
    });

    return { ...result, message: 'Role updated; the user must sign in again' };
  }

  private async findUser(userId: string): Promise<UserEntity> {
    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: userId, is_deleted: false } });
    if (!user) {
      throw new AppError(new NotFoundException('User not found'));
    }
    return user;
  }

  /** Staff accounts are managed through their role, never suspended or banned. */
  private async findManageableUser(
    actor: StaffActor,
    userId: string,
  ): Promise<UserEntity> {
    if (userId === actor.userId) {
      throw new AppError(
        new ForbiddenException('You cannot change your own account status'),
      );
    }
    const user = await this.findUser(userId);
    if (isStaff(user.role)) {
      throw new AppError(
        new ForbiddenException(
          'Staff accounts cannot be suspended or banned; change their role first',
        ),
      );
    }
    return user;
  }

  private recordStatusChange(
    actor: StaffActor | null,
    user: UserEntity,
    action: string,
    reason?: string,
    request?: Request,
    extra?: Record<string, unknown>,
  ) {
    return this.adminAudit.record({
      actor,
      entityType: AuditEntityType.USERS,
      entityId: user.id,
      action,
      oldValues: {
        account_status: user.account_status,
        is_active: user.is_active,
        suspended_until: user.suspended_until,
      },
      newValues: {
        account_status:
          action === USER_REINSTATED
            ? AccountStatus.ACTIVE
            : action === USER_BANNED
              ? AccountStatus.BANNED
              : AccountStatus.SUSPENDED,
        is_active: action === USER_REINSTATED,
        ...extra,
      },
      reason,
      request,
    });
  }
}
