import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { STAFF_ROLES } from '../user/entities/user.entity';
import {
  StaffNotificationEntity,
  StaffNotificationType,
} from './entities/staff-notification.entity';

export interface StaffEntry {
  type: StaffNotificationType;
  title: string;
  body?: string | null;
  /** Back office path to open. */
  link?: string | null;
}

/** Longest a title or body may be; longer text (a report reason, say) is cut. */
const TITLE_MAX = 150;
const BODY_MAX = 500;

const clip = (text: string | null | undefined, max: number) =>
  text && text.length > max ? `${text.slice(0, max - 1)}…` : (text ?? null);

/**
 * The back office inbox: entries for staff about things that need them.
 * Writing is best-effort like notify(): it never throws, so an inbox entry
 * can't fail the report, complaint or listing it is about.
 */
@Injectable()
export class StaffInboxService {
  private readonly logger = new Logger(StaffInboxService.name);

  constructor(
    @InjectRepository(StaffNotificationEntity)
    private readonly entries: Repository<StaffNotificationEntity>,
  ) {}

  /** One entry for every active staff member, except `exceptUserId`. */
  async toAllStaff(entry: StaffEntry, exceptUserId?: string): Promise<void> {
    try {
      await this.entries.query(
        `INSERT INTO staff_notifications (user_id, type, title, body, link)
         SELECT u.id, $1, $2, $3, $4 FROM users u
         WHERE u.role::text = ANY($5) AND u.is_deleted = false AND u.is_active = true
           AND ($6::uuid IS NULL OR u.id <> $6::uuid)`,
        [
          entry.type,
          clip(entry.title, TITLE_MAX),
          clip(entry.body, BODY_MAX),
          entry.link ?? null,
          STAFF_ROLES,
          exceptUserId ?? null,
        ],
      );
    } catch (error) {
      this.logFailure(error);
    }
  }

  async toUser(userId: string, entry: StaffEntry): Promise<void> {
    try {
      await this.entries.insert({
        user_id: userId,
        type: entry.type,
        title: clip(entry.title, TITLE_MAX)!,
        body: clip(entry.body, BODY_MAX),
        link: entry.link ?? null,
      });
    } catch (error) {
      this.logFailure(error);
    }
  }

  async list(
    userId: string,
    { unread = false, page = 1, limit = 20 },
  ): Promise<{
    rows: StaffNotificationEntity[];
    total: number;
    unread: number;
  }> {
    const [[rows, total], unreadCount] = await Promise.all([
      this.entries.findAndCount({
        where: { user_id: userId, ...(unread && { read_at: IsNull() }) },
        order: { created_at: 'DESC', id: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.unreadCount(userId),
    ]);
    return { rows, total, unread: unreadCount };
  }

  unreadCount(userId: string): Promise<number> {
    return this.entries.count({
      where: { user_id: userId, read_at: IsNull() },
    });
  }

  /** @returns false if the entry isn't this user's. */
  async markRead(userId: string, id: string): Promise<boolean> {
    const found = await this.entries.exists({ where: { id, user_id: userId } });
    if (!found) return false;
    await this.entries.update(
      { id, user_id: userId, read_at: IsNull() },
      { read_at: new Date() },
    );
    return true;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.entries.update(
      { user_id: userId, read_at: IsNull() },
      { read_at: new Date() },
    );
    return result.affected ?? 0;
  }

  private logFailure(error: unknown): void {
    this.logger.warn(
      `Staff inbox entry not written: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}
