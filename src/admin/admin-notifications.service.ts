import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { AuditEntityType } from '../audit/audit.constants';
import { AppError } from '../common/app-error';
import { ServiceResponseDto } from '../common/service-response.dto';
import { escapeLike } from '../common/text-fold';
import {
  AdminNotificationEntity,
  AdminNotificationStatus,
  AudienceFilter,
  NotificationAudience,
} from '../notification/entities/admin-notification.entity';
import {
  NotificationService,
  PUSH_IDLE_DAYS,
} from '../notification/notification.service';
import {
  Notice,
  NotificationCategory,
} from '../notification/notification.types';
import { UserEntity } from '../user/entities/user.entity';
import { AdminAuditService, StaffActor } from './admin-audit.service';
import { toUserRef } from './admin-views';
import {
  NotificationAudienceDto,
  NotificationHistoryQueryDto,
  SendNotificationDto,
} from './dto/send-notification.dto';

export const NOTIFICATION_SENT = 'sent';

/** Users notified at once; each is a few queries and an FCM call. */
const BATCH = 25;

export type AdminNotification = ReturnType<typeof toAdminNotification>;

function toAdminNotification(n: AdminNotificationEntity) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    send_email: n.send_email,
    audience: n.audience,
    status: n.status,
    recipient_count: n.recipient_count,
    push_sent_count: n.push_sent_count,
    email_sent_count: n.email_sent_count,
    failure_count: n.failure_count,
    sender: toUserRef(n.sender),
    created_at: n.created_at,
    completed_at: n.completed_at,
  };
}

/**
 * Announcements staff send to users. Sending answers straight away and
 * delivers in the background, updating the counts as it goes; each user's
 * notification settings still apply (they can turn announcements off).
 */
@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly adminAudit: AdminAuditService,
    private readonly notifications: NotificationService,
  ) {}

  async list(
    query: NotificationHistoryQueryDto,
  ): Promise<ServiceResponseDto<AdminNotification[]>> {
    const { page = 1, limit = 20 } = query;
    const [rows, total] = await this.dataSource
      .getRepository(AdminNotificationEntity)
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.sender', 'sender')
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      message: 'Notifications retrieved successfully',
      data: rows.map(toAdminNotification),
      total,
      page,
      limit,
      state: true,
      statusCode: 200,
    };
  }

  /**
   * How many users a send to this audience would go to, and how many of
   * them each channel can reach: a push needs a signed-in app device, an
   * email an address, and both need the user not to have turned them off.
   * Mirrors the checks notify() makes, so staff see the reach before sending.
   */
  async countAudience(dto: NotificationAudienceDto) {
    const audience = await this.resolveAudience(dto);
    const off = (key: string) =>
      `(p.notification_settings->>'${key}') = 'false'`;
    const wants = (channel: 'push' | 'email') =>
      `u.notification_enabled IS NOT FALSE AND NOT COALESCE(${off(
        NotificationCategory.ANNOUNCEMENTS,
      )} OR ${off(channel)}, false)`;
    const row = await this.recipients(audience)
      .leftJoin('user_preferences', 'p', 'p.user_id = u.id')
      .select('COUNT(*)', 'count')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${wants('push')} AND EXISTS (
          SELECT 1 FROM user_sessions s
          WHERE s.user_id = u.id AND s.is_active = true
            AND s.fcm_token IS NOT NULL AND s.created_at > :idleSince))`,
        'push',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE u.email IS NOT NULL AND ${wants('email')})`,
        'email',
      )
      .setParameter(
        'idleSince',
        new Date(Date.now() - PUSH_IDLE_DAYS * 24 * 60 * 60 * 1000),
      )
      .getRawOne<{ count: string; push: string; email: string }>();
    return {
      message: 'Audience counted',
      data: {
        count: Number(row?.count ?? 0),
        push_reachable: Number(row?.push ?? 0),
        email_reachable: Number(row?.email ?? 0),
      },
      state: true,
      statusCode: 200,
    };
  }

  async send(actor: StaffActor, dto: SendNotificationDto, request?: Request) {
    const audience = await this.resolveAudience(dto);
    const ids = (
      await this.recipients(audience).select('u.id', 'id').getRawMany<{
        id: string;
      }>()
    ).map((r) => r.id);
    if (!ids.length) {
      throw new AppError(
        new BadRequestException('No users match this audience'),
      );
    }

    const repo = this.dataSource.getRepository(AdminNotificationEntity);
    const saved = await repo.save(
      repo.create({
        title: dto.title,
        body: dto.body,
        send_email: dto.send_email ?? false,
        audience,
        status: AdminNotificationStatus.SENDING,
        recipient_count: ids.length,
        sent_by: actor.userId,
      }),
    );

    await this.adminAudit.record({
      actor,
      entityType: AuditEntityType.NOTIFICATIONS,
      entityId: saved.id,
      action: NOTIFICATION_SENT,
      newValues: {
        title: saved.title,
        audience,
        send_email: saved.send_email,
        recipient_count: ids.length,
      },
      request,
    });

    void this.deliver(saved, ids);

    const row = await repo.findOneOrFail({
      where: { id: saved.id },
      relations: ['sender'],
    });
    return {
      message: `Sending to ${ids.length} ${ids.length === 1 ? 'user' : 'users'}`,
      data: toAdminNotification(row),
      state: true,
      statusCode: 201,
    };
  }

  /** Notifies each recipient, saving the counts after every batch. */
  private async deliver(
    notification: AdminNotificationEntity,
    userIds: string[],
  ): Promise<void> {
    const repo = this.dataSource.getRepository(AdminNotificationEntity);
    const notice = announcementNotice(notification);
    const counts = {
      push_sent_count: 0,
      email_sent_count: 0,
      failure_count: 0,
    };
    try {
      for (let i = 0; i < userIds.length; i += BATCH) {
        const results = await Promise.all(
          userIds
            .slice(i, i + BATCH)
            .map((id) => this.notifications.notify(id, notice)),
        );
        for (const { push, email } of results) {
          if (push === 'sent') counts.push_sent_count++;
          if (email === 'sent') counts.email_sent_count++;
          if (
            (push === 'failed' || email === 'failed') &&
            push !== 'sent' &&
            email !== 'sent'
          ) {
            counts.failure_count++;
          }
        }
        await repo.update(notification.id, counts);
      }
      await repo.update(notification.id, {
        status: AdminNotificationStatus.SENT,
        completed_at: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Notification ${notification.id} stopped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await repo
        .update(notification.id, {
          ...counts,
          status: AdminNotificationStatus.FAILED,
          completed_at: new Date(),
        })
        .catch(() => undefined);
    }
  }

  /** The DTO as stored: only the fields its audience type uses. */
  private async resolveAudience(
    dto: NotificationAudienceDto,
  ): Promise<AudienceFilter> {
    switch (dto.audience) {
      case NotificationAudience.USER: {
        const exists = await this.dataSource
          .getRepository(UserEntity)
          .exists({ where: { id: dto.user_id, is_deleted: false } });
        if (!exists)
          throw new AppError(new NotFoundException('User not found'));
        return { type: dto.audience, user_id: dto.user_id };
      }
      case NotificationAudience.LOCATION: {
        const city = dto.city || undefined;
        const region = dto.region || undefined;
        if (!city && !region) {
          throw new AppError(
            new BadRequestException('Give a city or a region'),
          );
        }
        return { type: dto.audience, city, region };
      }
      default:
        return { type: dto.audience };
    }
  }

  /**
   * Active users in the audience. Suspended and banned users are left out
   * here as well as by notify, so the counts match what can be delivered.
   */
  private recipients(audience: AudienceFilter): SelectQueryBuilder<UserEntity> {
    const qb = this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .where('u.is_deleted = false')
      .andWhere('u.is_active = true');

    switch (audience.type) {
      case NotificationAudience.USER:
        qb.andWhere('u.id = :userId', { userId: audience.user_id });
        break;
      case NotificationAudience.FOUNDING_FREERS:
        qb.andWhere('u.is_founding_freer = true');
        break;
      case NotificationAudience.LOCATION: {
        // Any of the user's saved locations counts.
        const conditions = ['l.user_id = u.id', 'l.is_deleted = false'];
        if (audience.city) conditions.push('l.city ILIKE :city');
        if (audience.region) conditions.push('l.region ILIKE :region');
        qb.andWhere(
          `EXISTS (SELECT 1 FROM locations l WHERE ${conditions.join(' AND ')})`,
          {
            city: audience.city && escapeLike(audience.city),
            region: audience.region && escapeLike(audience.region),
          },
        );
        break;
      }
    }
    return qb;
  }
}

function announcementNotice(n: AdminNotificationEntity): Notice {
  return {
    category: NotificationCategory.ANNOUNCEMENTS,
    title: n.title,
    body: n.body,
    data: { type: 'announcement', notification_id: n.id },
    ...(n.send_email && {
      email: {
        subject: n.title,
        paragraphs: n.body
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean),
      },
    }),
  };
}
