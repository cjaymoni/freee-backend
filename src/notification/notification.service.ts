import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserPreferenceEntity } from '../user/entities/user-preference.entity';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';
import { Notice } from './notification.types';
import { releaseFcmToken } from './device-tokens';

type Settings = Record<string, unknown>;

export interface NotifyOptions {
  /**
   * Session tokens whose devices already show this, e.g. the ones with the
   * app open in front of the user: they get no push.
   */
  skipDevicesOf?: string[];
}

/**
 * What happened on one channel: `skipped` when it wasn't attempted (the
 * user's settings, no device or no email address), `failed` when it was and
 * didn't go through.
 */
export type DeliveryOutcome = 'sent' | 'skipped' | 'failed';

export interface NotifyResult {
  push: DeliveryOutcome;
  email: DeliveryOutcome;
}

const NOT_SENT: NotifyResult = { push: 'skipped', email: 'skipped' };

class SessionNotLive extends Error {}

const DAY = 24 * 60 * 60 * 1000;

/** How long an unopened device keeps getting pushes. */
export const PUSH_IDLE_DAYS = 90;

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
   * action it reports. The result says what went out, for callers that count.
   */
  async notify(
    userId: string,
    notice: Notice,
    options: NotifyOptions = {},
  ): Promise<NotifyResult> {
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
      if (!user || user.is_deleted) return NOT_SENT;

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

      const [pushed, emailed] = await Promise.allSettled([
        push ? this.push(userId, notice, options) : Promise.resolve(false),
        email
          ? this.mail
              .sendNotice(user.email!, {
                subject: notice.email!.subject,
                title: notice.title,
                paragraphs: notice.email!.paragraphs,
              })
              .then(() => true)
          : Promise.resolve(false),
      ]);
      const outcome = (result: PromiseSettledResult<boolean>) => {
        if (result.status === 'rejected') {
          this.logFailure(result.reason);
          return 'failed';
        }
        return result.value ? 'sent' : 'skipped';
      };
      return { push: outcome(pushed), email: outcome(emailed) };
    } catch (error) {
      this.logFailure(error);
      return { push: 'failed', email: 'failed' };
    }
  }

  /**
   * Attach the app's FCM token to the session it is signed in with, and take
   * it off any other live session (see releaseFcmToken).
   *
   * @returns false, changing nothing, if the session is not live.
   */
  async registerDevice(
    userId: string,
    sessionToken: string,
    fcmToken: string,
  ): Promise<boolean> {
    return this.dataSource
      .transaction(async (manager) => {
        const result = await manager
          .createQueryBuilder()
          .update(UserSessionEntity)
          .set({ fcm_token: fcmToken })
          .where('session_token = :sessionToken', { sessionToken })
          .andWhere('user_id = :userId', { userId })
          .andWhere('is_active = true')
          .execute();
        // Rolls back, so no other session loses the token for nothing.
        if (!result.affected) throw new SessionNotLive();
        await releaseFcmToken(manager, fcmToken, sessionToken);
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof SessionNotLive) return false;
        throw error;
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

  private async push(
    userId: string,
    notice: Notice,
    { skipDevicesOf = [] }: NotifyOptions,
  ): Promise<boolean> {
    const tokens = await this.deviceTokens(userId, skipDevicesOf);
    if (!tokens.length) return false;

    const { sentCount, invalidTokens } = await this.firebase.sendToTokens(
      tokens,
      {
        title: notice.title,
        body: notice.body,
        data: { ...notice.data, category: notice.category },
      },
    );
    if (invalidTokens.length) await this.forget(invalidTokens);
    return sentCount > 0;
  }

  /**
   * The FCM tokens of the user's sessions that have not ended. A session
   * that sat idle past its refresh token still counts: the app is still
   * installed, and FCM tells us once a token stops working.
   *
   * Up to a point: one not opened for PUSH_IDLE_DAYS is left out. A phone
   * that changed accounts without the server hearing of it (signed out
   * offline, and the next login sent no token) would otherwise show the old
   * account's pushes for good. created_at measures it, since an app in use
   * gets a new session on every refresh.
   */
  private async deviceTokens(
    userId: string,
    skipDevicesOf: string[],
  ): Promise<string[]> {
    const query = this.sessions
      .createQueryBuilder('s')
      .select('DISTINCT s.fcm_token', 'token')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.is_active = true')
      .andWhere('s.fcm_token IS NOT NULL')
      .andWhere('s.created_at > :idleSince', {
        idleSince: new Date(Date.now() - PUSH_IDLE_DAYS * DAY),
      });
    if (skipDevicesOf.length) {
      // A device is known by its token, which survives session rotation.
      query.andWhere(
        `s.fcm_token NOT IN (
          SELECT x.fcm_token FROM user_sessions x
          WHERE x.session_token IN (:...skipDevicesOf) AND x.fcm_token IS NOT NULL
        )`,
        { skipDevicesOf },
      );
    }
    const rows = await query.getRawMany<{ token: string }>();
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
