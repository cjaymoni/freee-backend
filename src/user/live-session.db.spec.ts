import { join } from 'path';
import { DataSource } from 'typeorm';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import {
  describeWithDatabase,
  testDatabaseFor,
} from '../common/testing/test-database';
import { UserEntity } from './entities/user.entity';
import { UserService } from './user.service';

/**
 * UserService.withLiveSession against a real Postgres: an edit holding its
 * session makes ending that session wait, which is what keeps an email-code
 * handover (EmailAuthService.handOver) from being undercut by an edit that
 * was already under way.
 */
describeWithDatabase('UserService.withLiveSession on Postgres', () => {
  let ds: DataSource;
  let users: UserService;
  let user: UserEntity;
  let n = 0;

  const session = async () => {
    const token = `sess-${++n}`;
    await ds.getRepository(UserSessionEntity).save({
      user,
      session_token: token,
      refresh_token: `refresh-${token}`,
      refresh_token_expires_at: new Date(Date.now() + 86_400_000),
      expires_at: new Date(Date.now() + 900_000),
    });
    return token;
  };
  /** What EmailAuthService.handOver does first. */
  const endSessions = () =>
    ds
      .getRepository(UserSessionEntity)
      .update({ user: { id: user.id }, is_active: true }, { is_active: false });

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url: await testDatabaseFor('live_session'),
      entities: [join(__dirname, '..', '**', '*.entity.ts')],
      synchronize: true,
      dropSchema: true,
      logging: false,
    }).initialize();
    // withLiveSession only needs the data source.
    users = Object.assign(Object.create(UserService.prototype), {
      dataSource: ds,
    }) as UserService;
    user = await ds
      .getRepository(UserEntity)
      .save({ email: 'ama@example.com', first_name: 'Ama' });
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('makes ending the session wait until an edit under way has committed', async () => {
    const token = await session();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const hasLock = new Promise<void>((r) => (locked = r));

    const edit = users.withLiveSession(token, async (manager) => {
      locked();
      await gate;
      await manager.update(UserEntity, user.id, { first_name: 'Edited' });
      order.push('edit committed');
    });
    await hasLock;
    const ending = endSessions().then(() => order.push('sessions ended'));
    // Give the UPDATE time to reach the lock and wait on it.
    await new Promise((r) => setTimeout(r, 300));
    expect(order).toEqual([]);

    release();
    await Promise.all([edit, ending]);
    expect(order).toEqual(['edit committed', 'sessions ended']);
  });

  it('refuses an edit whose session has ended, and runs nothing', async () => {
    const token = await session();
    await endSessions();
    const work = jest.fn();
    await expect(users.withLiveSession(token, work)).rejects.toMatchObject({
      status: 401,
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('refuses an edit that was waiting while its session was ended', async () => {
    const token = await session();
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    // Ending the sessions is under way: its row lock is held.
    await runner.manager.update(
      UserSessionEntity,
      { session_token: token },
      { is_active: false },
    );
    const work = jest.fn();
    const edit = users.withLiveSession(token, work);
    await new Promise((r) => setTimeout(r, 300));
    await runner.commitTransaction();
    await runner.release();
    await expect(edit).rejects.toMatchObject({ status: 401 });
    expect(work).not.toHaveBeenCalled();
  });
});
