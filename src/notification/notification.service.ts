import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserPreferenceEntity } from '../user/entities/user-preference.entity';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';
import { Notice } from './notification.types';

type Settings = Record<string, unknown>;

/**
 * Sends a user push notifications and emails, and keeps track of the
 * devices they can be pushed to.
 *
 * A device is a login session: the app registers its FCM token against the
 * session it is signed in with. Pushes go to every live session, so a user
 * signed in on two phones gets both, and one that signed out (or was banned,
 * or reset their password, which end sessions) gets none.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(UserPreferenceEntity)
    private readonly preferences: Repository<UserPreferenceEntity>,
    @InjectRepository(UserSessionEntity)
    private readonly sessions: Repository<UserSessionEntity>,
    private readonly dataSource: DataSource,
    private readonly firebase: FirebaseService,
    private readonly mail: MailService,
  ) {}

  /**
   * Tell a user something, by push and, if the notice has one, by email,
   * as far as their settings allow.
   *
   * Best-effort: it never throws, so a notification can't undo or fail the
   * action it reports.
   */
  async notify(userId: string, notice: Notice): Promise<void> {
    try {
      const user = await this.users.findOne({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          notification_enabled: true,
          is_active: true,
          is_deleted: true,
        },
      });
      if (!user || user.is_deleted) return;

      const settings = await this.settingsFor(userId);
      const wantsCategory = settings[notice.category] !== false;
      const wantsNotifications = user.notification_enabled !== false;

      const push =
        wantsNotifications &&
        wantsCategory &&
        settings.push !== false &&
        (user.is_active || notice.evenIfInactive === true);
      const email =
        !!notice.email &&
        !!user.email &&
        (notice.email.transactional === true ||
          (wantsNotifications && wantsCategory && settings.email !== false));

      const results = await Promise.allSettled([
        push ? this.push(userId, notice) : Promise.resolve(),
        email
          ? this.mail.sendNotice(user.email!, {
              subject: notice.email!.subject,
              title: notice.title,
              paragraphs: notice.email!.paragraphs,
            })
          : Promise.resolve(),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') this.logFailure(result.reason);
      }
    } catch (error) {
      this.logFailure(error);
    }
  }

  /**
   * Attach the app's FCM token to the session it is signed in with. A token
   * belongs to one install, so any other session holding it (another
   * account signed in on that phone before) lets go of it.
   *
   * @returns false if the session is not live.
   */
  async registerDevice(
    userId: string,
    sessionToken: string,
    fcmToken: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(UserSessionEntity)
        .set({ fcm_token: () => 'NULL' })
        .where('fcm_token = :fcmToken', { fcmToken })
        .andWhere('session_token <> :sessionToken', { sessionToken })
        .execute();
      const result = await manager
        .createQueryBuilder()
        .update(UserSessionEntity)
        .set({ fcm_token: fcmToken })
        .where('session_token = :sessionToken', { sessionToken })
        .andWhere('user_id = :userId', { userId })
        .andWhere('is_active = true')
        .execute();
      return (result.affected ?? 0) > 0;
    });
  }

  /** Stop pushing to the device behind this session, e.g. on sign-out. */
  async unregisterDevice(userId: string, sessionToken: string): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .update()
      .set({ fcm_token: () => 'NULL' })
      .where('session_token = :sessionToken', { sessionToken })
      .andWhere('user_id = :userId', { userId })
      .execute();
  }

  private async push(userId: string, notice: Notice): Promise<void> {
    const tokens = await this.deviceTokens(userId);
    if (!tokens.length) return;

    const { invalidTokens } = await this.firebase.sendToTokens(tokens, {
      title: notice.title,
      body: notice.body,
      data: { ...notice.data, category: notice.category },
    });
    if (invalidTokens.length) await this.forget(invalidTokens);
  }

  /**
   * The FCM tokens of the user's live sessions: not signed out, and not past
   * the point where the app could still refresh them.
   */
  private async deviceTokens(userId: string): Promise<string[]> {
    const rows = await this.sessions
      .createQueryBuilder('s')
      .select('DISTINCT s.fcm_token', 'token')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.is_active = true')
      .andWhere('s.fcm_token IS NOT NULL')
      .andWhere('COALESCE(s.refresh_token_expires_at, s.expires_at) > :now', {
        now: new Date(),
      })
      .getRawMany<{ token: string }>();
    return rows.map((row) => row.token);
  }

  /** Tokens FCM says are dead will never work again, on any session. */
  private async forget(tokens: string[]): Promise<void> {
    await this.sessions.update({ fcm_token: In(tokens) }, { fcm_token: null });
    this.logger.log(`Forgot ${tokens.length} dead FCM token(s)`);
  }

  private async settingsFor(userId: string): Promise<Settings> {
    const preference = await this.preferences.findOne({
      where: { user_id: userId },
      select: { id: true, notification_settings: true },
    });
    const settings = preference?.notification_settings;
    return settings && typeof settings === 'object' ? settings : {};
  }

  private logFailure(error: unknown): void {
    this.logger.warn(
      `Notification not delivered: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}
