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

  /** Backdate a session, since saves in a row can share a timestamp. */
  const createdHoursAgo = (sessionToken: string, hours: number) =>
    ds.query(
      'UPDATE user_sessions SET created_at = $1 WHERE session_token = $2',
      [new Date(Date.now() - hours * HOUR), sessionToken],
    );

  it('pushes to every device not signed out, however long idle', async () => {
    await session(ama, 'ama-phone');
    await session(ama, 'ama-tablet');
    await service.registerDevice(ama.id, 'ama-phone', 'fcm-phone');
    await service.registerDevice(ama.id, 'ama-tablet', 'fcm-tablet');
    await session(ama, 'ama-old', {
      is_active: false,
      fcm_token: 'fcm-signed-out',
    });
    // Unopened for weeks: its refresh token ran out, but it never signed out.
    await session(ama, 'ama-idle', {
      refresh_token_expires_at: new Date(Date.now() - 30 * 24 * HOUR),
      expires_at: new Date(Date.now() - 30 * 24 * HOUR),
      fcm_token: 'fcm-idle',
    });

    expect(await pushedTo(ama.id)).toEqual([
      'fcm-idle',
      'fcm-phone',
      'fcm-tablet',
    ]);
  });

  it('moves a token to whoever signs in on that phone next', async () => {
    await session(kofi, 'kofi-phone');

    await service.registerDevice(kofi.id, 'kofi-phone', 'fcm-phone');

    expect(await tokenOf('ama-phone')).toBeNull();
    expect(await pushedTo(kofi.id)).toEqual(['fcm-phone']);
    expect(await pushedTo(ama.id)).toEqual(['fcm-idle', 'fcm-tablet']);
  });

  it('leaves the token on ended sessions, which still name their device', async () => {
    await service.registerDevice(ama.id, 'ama-tablet', 'fcm-signed-out');

    expect(await tokenOf('ama-old')).toBe('fcm-signed-out');
  });

  it("changes nothing for a session that is over or someone else's", async () => {
    expect(
      await service.registerDevice(ama.id, 'ama-old', 'fcm-signed-out'),
    ).toBe(false);
    expect(
      await service.registerDevice(ama.id, 'kofi-phone', 'fcm-phone'),
    ).toBe(false);
    // The failed attempts took the token off no one.
    expect(await tokenOf('ama-tablet')).toBe('fcm-signed-out');
    expect(await tokenOf('kofi-phone')).toBe('fcm-phone');
  });

  it('skips a device with the app open, even after its session rotated', async () => {
    await service.registerDevice(ama.id, 'ama-tablet', 'fcm-tablet');
    // The tablet's socket connected on ama-tablet; a refresh then ended that
    // session and carried the token onto a new one.
    await session(ama, 'ama-tablet-2', { fcm_token: 'fcm-tablet' });
    await ds.query(
      "UPDATE user_sessions SET is_active = false WHERE session_token = 'ama-tablet'",
    );

    firebase.sendToTokens.mockClear();
    await service.notify(
      ama.id,
      { category: NotificationCategory.CHAT_MESSAGES, title: 't', body: 'b' },
      { skipDevicesOf: ['ama-tablet', 'ama-web-without-token'] },
    );

    expect(firebase.sendToTokens.mock.calls[0][0]).toEqual(['fcm-idle']);
  });

  it('stops one device without touching the others', async () => {
    await session(ama, 'ama-laptop');
    await service.registerDevice(ama.id, 'ama-laptop', 'fcm-laptop');

    await service.unregisterDevice(ama.id, 'ama-laptop');

    expect(await tokenOf('ama-laptop')).toBeNull();
    expect(await pushedTo(ama.id)).toEqual(['fcm-idle', 'fcm-tablet']);
  });

  it('forgets a token FCM reports dead, on every session holding it', async () => {
    firebase.sendToTokens.mockResolvedValueOnce({
      invalidTokens: ['fcm-tablet'],
    });

    await pushedTo(ama.id);

    expect(await tokenOf('ama-tablet')).toBeNull();
    expect(await tokenOf('ama-tablet-2')).toBeNull();
    expect(await pushedTo(ama.id)).toEqual(['fcm-idle']);
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

    it("copies each user's token onto their latest session not signed out", async () => {
      const [efua] = await ds
        .getRepository(UserEntity)
        .save([{ email: 'efua@example.com', fcm_token: 'fcm-legacy' }]);
      await session(efua, 'efua-older');
      await session(efua, 'efua-latest', {
        // Idle past its refresh token still counts, as for sending.
        refresh_token_expires_at: new Date(Date.now() - HOUR),
      });
      await session(efua, 'efua-ended', { is_active: false });
      await createdHoursAgo('efua-older', 3);
      await createdHoursAgo('efua-latest', 2);
      await createdHoursAgo('efua-ended', 1);

      await run();

      expect(await tokenOf('efua-latest')).toBe('fcm-legacy');
      expect(await tokenOf('efua-older')).toBeNull();
      expect(await tokenOf('efua-ended')).toBeNull();
    });

    it('gives a token two users shared to the newest of their sessions', async () => {
      const [esi, yaw] = await ds.getRepository(UserEntity).save([
        { email: 'esi@example.com', fcm_token: 'fcm-shared' },
        { email: 'yaw@example.com', fcm_token: 'fcm-shared' },
      ]);
      await session(esi, 'esi-phone');
      await session(yaw, 'yaw-phone');
      await createdHoursAgo('esi-phone', 5);
      await createdHoursAgo('yaw-phone', 4);

      await run();

      expect(await tokenOf('yaw-phone')).toBe('fcm-shared');
      expect(await tokenOf('esi-phone')).toBeNull();
    });

    it('leaves a token alone that a session already holds', async () => {
      const [abena] = await ds
        .getRepository(UserEntity)
        .save([{ email: 'abena@example.com', fcm_token: 'fcm-phone' }]);
      await session(abena, 'abena-phone');

      await run();

      // kofi-phone registered fcm-phone itself; it is not copied again.
      expect(await tokenOf('abena-phone')).toBeNull();
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
