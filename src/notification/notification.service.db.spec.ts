import { join } from 'path';
import { DataSource } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationCategory } from './notification.types';
import { UserEntity } from '../user/entities/user.entity';
import { UserPreferenceEntity } from '../user/entities/user-preference.entity';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';
import { MoveFcmTokensToSessions1797000000000 } from '../migrations/1797000000000-MoveFcmTokensToSessions';
import {
  describeWithDatabase,
  testDatabaseFor,
} from '../common/testing/test-database';

/**
 * Device tokens against a real Postgres: which sessions count as a device,
 * how a token moves between accounts on one phone, and the migration that
 * moves the old per-user token onto sessions. See common/testing.
 */
describeWithDatabase('NotificationService devices on Postgres', () => {
  let ds: DataSource;
  let service: NotificationService;
  const firebase = {
    sendToTokens: jest.fn<
      Promise<{ invalidTokens: string[] }>,
      [string[], unknown]
    >(),
  };
  let ama: UserEntity;
  let kofi: UserEntity;

  const HOUR = 3_600_000;
  const session = (
    user: UserEntity,
    token: string,
    extra: Partial<UserSessionEntity> = {},
  ) =>
    ds.getRepository(UserSessionEntity).save({
      user,
      session_token: token,
      refresh_token: `refresh-${token}`,
      refresh_token_expires_at: new Date(Date.now() + 24 * HOUR),
      expires_at: new Date(Date.now() + HOUR),
      ...extra,
    });
  const tokenOf = async (sessionToken: string) =>
    (
      await ds
        .getRepository(UserSessionEntity)
        .findOneByOrFail({ session_token: sessionToken })
    ).fcm_token;
  const pushedTo = async (userId: string) => {
    firebase.sendToTokens.mockClear();
    await service.notify(userId, {
      category: NotificationCategory.CHAT_MESSAGES,
      title: 't',
      body: 'b',
    });
    return (firebase.sendToTokens.mock.calls[0]?.[0] ?? []).sort();
  };

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url: await testDatabaseFor('notification'),
      entities: [join(__dirname, '..', '**', '*.entity.ts')],
      synchronize: true,
      dropSchema: true,
      logging: false,
    }).initialize();
    service = new NotificationService(
      ds.getRepository(UserEntity),
      ds.getRepository(UserPreferenceEntity),
      ds.getRepository(UserSessionEntity),
      ds,
      firebase as unknown as FirebaseService,
      { sendNotice: jest.fn() } as unknown as MailService,
    );
    [ama, kofi] = await ds.getRepository(UserEntity).save([
      { email: 'ama@example.com', first_name: 'Ama' },
      { email: 'kofi@example.com', first_name: 'Kofi' },
    ]);
  });

  beforeEach(() => {
    firebase.sendToTokens.mockResolvedValue({ invalidTokens: [] });
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('pushes to each signed-in device, not signed-out or expired ones', async () => {
    await session(ama, 'ama-phone');
    await session(ama, 'ama-tablet');
    await service.registerDevice(ama.id, 'ama-phone', 'fcm-phone');
    await service.registerDevice(ama.id, 'ama-tablet', 'fcm-tablet');
    await session(ama, 'ama-old', {
      is_active: false,
      fcm_token: 'fcm-signed-out',
    });
    await session(ama, 'ama-stale', {
      refresh_token_expires_at: new Date(Date.now() - HOUR),
      fcm_token: 'fcm-expired',
    });

    expect(await pushedTo(ama.id)).toEqual(['fcm-phone', 'fcm-tablet']);
  });

  it('moves a token to whoever signs in on that phone next', async () => {
    await session(kofi, 'kofi-phone');

    await service.registerDevice(kofi.id, 'kofi-phone', 'fcm-phone');

    expect(await tokenOf('ama-phone')).toBeNull();
    expect(await pushedTo(kofi.id)).toEqual(['fcm-phone']);
    expect(await pushedTo(ama.id)).toEqual(['fcm-tablet']);
  });

  it("won't attach a token to a session that is over or someone else's", async () => {
    expect(await service.registerDevice(ama.id, 'ama-old', 'fcm-x')).toBe(
      false,
    );
    expect(await service.registerDevice(ama.id, 'kofi-phone', 'fcm-x')).toBe(
      false,
    );
    expect(await tokenOf('kofi-phone')).toBe('fcm-phone');
  });

  it('stops one device without touching the others', async () => {
    await session(ama, 'ama-laptop');
    await service.registerDevice(ama.id, 'ama-laptop', 'fcm-laptop');

    await service.unregisterDevice(ama.id, 'ama-laptop');

    expect(await tokenOf('ama-laptop')).toBeNull();
    expect(await pushedTo(ama.id)).toEqual(['fcm-tablet']);
  });

  it('forgets a token FCM reports dead, on every session holding it', async () => {
    firebase.sendToTokens.mockResolvedValueOnce({
      invalidTokens: ['fcm-tablet'],
    });

    await pushedTo(ama.id);

    expect(await tokenOf('ama-tablet')).toBeNull();
    expect(await pushedTo(ama.id)).toEqual([]);
  });

  describe('MoveFcmTokensToSessions migration', () => {
    const migration = new MoveFcmTokensToSessions1797000000000();
    const run = async () => {
      const runner = ds.createQueryRunner();
      try {
        await migration.up(runner);
      } finally {
        await runner.release();
      }
    };

    it("copies each user's token onto their latest live session", async () => {
      const [efua] = await ds
        .getRepository(UserEntity)
        .save([{ email: 'efua@example.com', fcm_token: 'fcm-legacy' }]);
      await session(efua, 'efua-older', {
        last_activity: new Date(Date.now() - 2 * HOUR),
      });
      await session(efua, 'efua-latest', { last_activity: new Date() });
      await session(efua, 'efua-ended', {
        is_active: false,
        last_activity: new Date(Date.now() + HOUR),
      });

      await run();

      expect(await tokenOf('efua-latest')).toBe('fcm-legacy');
      expect(await tokenOf('efua-older')).toBeNull();
      expect(await tokenOf('efua-ended')).toBeNull();
    });

    it('leaves a token alone that a session already holds', async () => {
      const [yaw] = await ds
        .getRepository(UserEntity)
        .save([{ email: 'yaw@example.com', fcm_token: 'fcm-phone' }]);
      await session(yaw, 'yaw-phone');

      await run();

      // kofi-phone registered fcm-phone itself; it is not copied again.
      expect(await tokenOf('yaw-phone')).toBeNull();
      expect(await tokenOf('kofi-phone')).toBe('fcm-phone');
    });

    it('can run again, and leaves the token index in place', async () => {
      await run();
      const [{ count }] = await ds.query<{ count: string }[]>(
        `SELECT count(*) FROM pg_indexes WHERE indexname = 'IDX_user_sessions_fcm_token'`,
      );
      expect(Number(count)).toBe(1);
    });
  });
});
