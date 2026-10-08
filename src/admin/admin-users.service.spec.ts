import { StaffInboxService } from '../notification/staff-inbox.service';
import { DataSource } from 'typeorm';
import {
  AccountStatus,
  UserEntity,
  UserRole,
} from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { AdminAuditService } from './admin-audit.service';
import { NotificationService } from '../notification/notification.service';
import { Notice } from '../notification/notification.types';
import {
  AdminUsersService,
  ROLE_CHANGED,
  USER_BANNED,
  USER_REINSTATED,
  USER_SUSPENDED,
} from './admin-users.service';

const admin = { userId: 'admin-1', role: UserRole.ADMIN };
const moderator = { userId: 'mod-1', role: UserRole.MODERATOR };

const member = (overrides: Partial<UserEntity> = {}) =>
  ({
    id: 'u-1',
    email: 'u1@example.com',
    firebase_uid: 'fb-1',
    role: UserRole.USER,
    is_active: true,
    account_status: AccountStatus.ACTIVE,
    suspended_until: null,
    ...overrides,
  }) as UserEntity;

const setup = (user: UserEntity | null, lifted: object[] = []) => {
  const manager = { update: jest.fn().mockResolvedValue({}) };
  const userRepo = { findOne: jest.fn().mockResolvedValue(user) };
  const liftQuery = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ raw: lifted }),
  };
  const dataSource = {
    getRepository: () => userRepo,
    createQueryBuilder: () => liftQuery,
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const userService = {
    update: jest.fn().mockResolvedValue({
      state: true,
      data: { id: 'u-1', role: UserRole.MODERATOR },
      message: 'User updated successfully',
      statusCode: 200,
    }),
    setAccountState: jest.fn().mockResolvedValue(true),
    clearUserCache: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const firebase = { revokeRefreshTokens: jest.fn().mockResolvedValue(true) };
  const chat = { disconnectUser: jest.fn() };
  const notifications = {
    notify: jest
      .fn<Promise<void>, [string, Notice]>()
      .mockResolvedValue(undefined),
  };
  const staffInbox = { toUser: jest.fn() };
  const service = new AdminUsersService(
    dataSource as unknown as DataSource,
    userService as unknown as UserService,
    audit as unknown as AdminAuditService,
    firebase as unknown as FirebaseService,
    chat as unknown as ChatRealtimeService,
    notifications as unknown as NotificationService,
    staffInbox as unknown as StaffInboxService,
  );
  // detail() runs a dozen counts; the actions only need to reach it.
  jest.spyOn(service, 'detail').mockResolvedValue({ data: {} } as never);
  return {
    service,
    manager,
    userService,
    audit,
    firebase,
    chat,
    userRepo,
    liftQuery,
    notifications,
    staffInbox,
  };
};

const ends = { user: { id: 'u-1' }, is_active: true };

describe('AdminUsersService.changeRole', () => {
  it('tells the user in their back office inbox', async () => {
    const { service, staffInbox } = setup(member());
    await service.changeRole(admin, 'u-1', UserRole.MODERATOR);
    expect(staffInbox.toUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({
        type: 'role_changed',
        body: 'You are now a moderator.',
      }),
    );
  });

  it('changes the role, ends sessions and audits the change', async () => {
    const { service, manager, userService, audit } = setup(member());

    const res = await service.changeRole(
      admin,
      'u-1',
      UserRole.MODERATOR,
      'New moderator',
    );

    expect(res.data).toMatchObject({ role: UserRole.MODERATOR });
    expect(userService.update).toHaveBeenCalledWith(
      'u-1',
      { role: UserRole.MODERATOR },
      manager,
    );
    expect(manager.update).toHaveBeenCalledWith(UserSessionEntity, ends, {
      is_active: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: admin,
        entityId: 'u-1',
        action: ROLE_CHANGED,
        oldValues: { role: UserRole.USER },
        newValues: { role: UserRole.MODERATOR },
        reason: 'New moderator',
      }),
    );
  });

  it('refuses to change your own role', async () => {
    const { service, userService } = setup(
      member({ id: admin.userId, role: UserRole.ADMIN }),
    );

    await expect(
      service.changeRole(admin, admin.userId, UserRole.USER),
    ).rejects.toMatchObject({ status: 403 });
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('404s on a missing user', async () => {
    const { service } = setup(null);

    await expect(
      service.changeRole(admin, 'nope', UserRole.MODERATOR),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([AccountStatus.SUSPENDED, AccountStatus.BANNED])(
    'refuses making a %s account staff',
    async (account_status) => {
      const { service, userService } = setup(
        member({ is_active: false, account_status }),
      );

      await expect(
        service.changeRole(admin, 'u-1', UserRole.MODERATOR),
      ).rejects.toMatchObject({ status: 409 });
      expect(userService.update).not.toHaveBeenCalled();
    },
  );

  it('400s when the role is unchanged', async () => {
    const { service, audit } = setup(member({ role: UserRole.MODERATOR }));

    await expect(
      service.changeRole(admin, 'u-1', UserRole.MODERATOR),
    ).rejects.toMatchObject({ status: 400 });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AdminUsersService.suspend', () => {
  const later = () => new Date(Date.now() + 86_400_000).toISOString();

  it('deactivates the account, keeps its sessions and audits the reason', async () => {
    const { service, userService, manager, audit, chat } = setup(member());
    const until = later();

    await service.suspend(moderator, 'u-1', 'No-shows', until);

    expect(userService.setAccountState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      AccountStatus.ACTIVE,
      {
        is_active: false,
        account_status: AccountStatus.SUSPENDED,
        status_reason: 'No-shows',
        suspended_until: new Date(until),
        status_changed_by: moderator.userId,
      },
    );
    // Suspended users keep their sessions so they can still appeal, but
    // chat isn't an appeal route, so open sockets go.
    expect(manager.update).not.toHaveBeenCalled();
    expect(chat.disconnectUser).toHaveBeenCalledWith('u-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: moderator,
        action: USER_SUSPENDED,
        reason: 'No-shows',
      }),
    );
  });

  it('409s without auditing when the account changed meanwhile', async () => {
    const { service, userService, audit, chat } = setup(member());
    userService.setAccountState.mockResolvedValue(false);

    await expect(
      service.suspend(moderator, 'u-1', 'No-shows'),
    ).rejects.toMatchObject({ status: 409 });
    expect(audit.record).not.toHaveBeenCalled();
    expect(chat.disconnectUser).not.toHaveBeenCalled();
  });

  it('refuses an end date in the past', async () => {
    const { service, userService } = setup(member());

    await expect(
      service.suspend(moderator, 'u-1', 'x', '2020-01-01T00:00:00Z'),
    ).rejects.toMatchObject({ status: 400 });
    expect(userService.setAccountState).not.toHaveBeenCalled();
  });

  it.each([UserRole.ADMIN, UserRole.MODERATOR])(
    'refuses to suspend a %s',
    async (role) => {
      const { service, userService } = setup(member({ role }));

      await expect(service.suspend(admin, 'u-1', 'x')).rejects.toMatchObject({
        status: 403,
      });
      expect(userService.setAccountState).not.toHaveBeenCalled();
    },
  );

  it('refuses to act on your own account', async () => {
    const { service } = setup(member({ id: moderator.userId }));

    await expect(
      service.suspend(moderator, moderator.userId, 'x'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a banned account', async () => {
    const { service } = setup(
      member({ is_active: false, account_status: AccountStatus.BANNED }),
    );

    await expect(service.suspend(moderator, 'u-1', 'x')).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('AdminUsersService.ban', () => {
  it('bans, ends sessions, drops sockets and revokes Firebase tokens', async () => {
    const { service, userService, manager, firebase, audit, chat } =
      setup(member());

    await service.ban(admin, 'u-1', 'Fraud');

    expect(userService.setAccountState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      AccountStatus.ACTIVE,
      expect.objectContaining({
        is_active: false,
        account_status: AccountStatus.BANNED,
        status_reason: 'Fraud',
        suspended_until: null,
      }),
      manager,
    );
    expect(manager.update).toHaveBeenCalledWith(UserSessionEntity, ends, {
      is_active: false,
    });
    // After commit, so a read in between can't cache the old state.
    expect(userService.clearUserCache).toHaveBeenCalled();
    expect(chat.disconnectUser).toHaveBeenCalledWith('u-1');
    expect(firebase.revokeRefreshTokens).toHaveBeenCalledWith('fb-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: USER_BANNED, reason: 'Fraud' }),
    );
  });

  it('keeps sessions when the account changed meanwhile', async () => {
    const { service, userService, manager, firebase } = setup(
      member({ is_active: false, account_status: AccountStatus.SUSPENDED }),
    );
    userService.setAccountState.mockResolvedValue(false);

    await expect(service.ban(admin, 'u-1', 'Fraud')).rejects.toMatchObject({
      status: 409,
    });
    expect(userService.setAccountState).toHaveBeenCalledWith(
      expect.anything(),
      AccountStatus.SUSPENDED,
      expect.anything(),
      manager,
    );
    expect(manager.update).not.toHaveBeenCalled();
    expect(firebase.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('still bans when Firebase revocation fails', async () => {
    const { service, firebase, audit } = setup(member());
    firebase.revokeRefreshTokens.mockResolvedValue(false);

    await service.ban(admin, 'u-1', 'Fraud');

    expect(audit.record).toHaveBeenCalled();
  });

  it('refuses an account that is already banned', async () => {
    const { service } = setup(
      member({ is_active: false, account_status: AccountStatus.BANNED }),
    );

    await expect(service.ban(admin, 'u-1', 'x')).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('AdminUsersService.reinstate', () => {
  const suspended = () =>
    member({ is_active: false, account_status: AccountStatus.SUSPENDED });
  const banned = () =>
    member({ is_active: false, account_status: AccountStatus.BANNED });

  it('lets a moderator lift a suspension', async () => {
    const { service, userService, audit } = setup(suspended());

    await service.reinstate(moderator, 'u-1', 'Appeal accepted');

    expect(userService.setAccountState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      AccountStatus.SUSPENDED,
      {
        is_active: true,
        account_status: AccountStatus.ACTIVE,
        status_reason: null,
        suspended_until: null,
        status_changed_by: moderator.userId,
      },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: USER_REINSTATED }),
    );
  });

  it('only lets an admin lift a ban', async () => {
    const asModerator = setup(banned());
    await expect(
      asModerator.service.reinstate(moderator, 'u-1'),
    ).rejects.toMatchObject({ status: 403 });
    expect(asModerator.userService.setAccountState).not.toHaveBeenCalled();

    const asAdmin = setup(banned());
    await asAdmin.service.reinstate(admin, 'u-1');
    expect(asAdmin.userService.setAccountState).toHaveBeenCalled();
  });

  it.each([true, false])(
    'refuses an active account (is_active=%s, i.e. awaiting verification)',
    async (is_active) => {
      const { service, userService } = setup(member({ is_active }));

      await expect(service.reinstate(admin, 'u-1')).rejects.toMatchObject({
        status: 409,
      });
      expect(userService.setAccountState).not.toHaveBeenCalled();
    },
  );

  it('409s when the account changed meanwhile', async () => {
    const { service, userService, audit } = setup(suspended());
    userService.setAccountState.mockResolvedValue(false);

    await expect(service.reinstate(moderator, 'u-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AdminUsersService.liftExpiredSuspensions', () => {
  it('lifts expired suspensions in one conditional update, audited as the system', async () => {
    const lifted = { id: 'u-1', email: 'u1@example.com', firebase_uid: 'fb-1' };
    const { service, userService, audit, liftQuery } = setup(null, [lifted]);

    await expect(service.liftExpiredSuspensions()).resolves.toBe(1);

    // Only rows still suspended and past their end date: a ban or new
    // suspension in the meantime no longer matches.
    expect(liftQuery.where).toHaveBeenCalledWith(
      'account_status = :suspended',
      { suspended: AccountStatus.SUSPENDED },
    );
    expect(liftQuery.andWhere).toHaveBeenCalledWith(
      'suspended_until <= :now',
      expect.objectContaining({ now: expect.any(Date) }),
    );
    expect(liftQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: true,
        account_status: AccountStatus.ACTIVE,
        suspended_until: null,
      }),
    );
    expect(userService.clearUserCache).toHaveBeenCalledWith(lifted);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: null,
        entityId: 'u-1',
        action: USER_REINSTATED,
      }),
    );
  });

  it('audits nothing when nothing expired', async () => {
    const { service, audit } = setup(null, []);

    await expect(service.liftExpiredSuspensions()).resolves.toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('AdminUsersService.list filters', () => {
  it('escapes the search and applies status and role', async () => {
    const calls: [unknown, unknown?][] = [];
    const qb: Record<string, unknown> = {};
    for (const m of ['where', 'skip', 'take']) qb[m] = () => qb;
    for (const m of ['orderBy', 'addOrderBy']) {
      qb[m] = (column: string, direction: string) => {
        calls.push([`${m} ${column} ${direction}`]);
        return qb;
      };
    }
    qb.andWhere = (sql: unknown, params?: unknown) => {
      calls.push([typeof sql === 'string' ? sql : 'brackets', params]);
      return qb;
    };
    qb.getManyAndCount = () => Promise.resolve([[], 0]);
    const { service } = setup(null);
    Object.assign(service, {
      dataSource: { getRepository: () => ({ createQueryBuilder: () => qb }) },
    });

    await service.list({
      search: ' 50%_off ',
      account_status: AccountStatus.BANNED,
      role: UserRole.USER,
      order: 'ASC',
    });

    expect(calls).toContainEqual(['orderBy u.created_at ASC']);
    expect(calls).toContainEqual(['addOrderBy u.id ASC']);
    expect(calls).toContainEqual(['brackets', { search: '%50\\%\\_off%' }]);
    expect(calls).toContainEqual([
      'u.account_status = :status',
      { status: AccountStatus.BANNED },
    ]);
    expect(calls).toContainEqual(['u.role = :role', { role: UserRole.USER }]);
  });
});

describe('AdminUsersService notices', () => {
  const noticeFor = (notifications: {
    notify: jest.Mock<Promise<void>, [string, Notice]>;
  }) => {
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    return notifications.notify.mock.calls[0];
  };

  it('tells a suspended user until when, and why', async () => {
    const { service, notifications } = setup(member());
    const until = new Date(Date.now() + 86_400_000);

    await service.suspend(moderator, 'u-1', 'Spam', until.toISOString());

    const [userId, notice] = noticeFor(notifications);
    expect(userId).toBe('u-1');
    expect(notice.title).toBe('Your account has been suspended');
    expect(notice.evenIfInactive).toBe(true);
    expect(notice.email?.transactional).toBe(true);
    expect(notice.email?.paragraphs).toContain('Reason: Spam');
  });

  it('emails a banned user, since their sessions are gone', async () => {
    const { service, notifications } = setup(member());

    await service.ban(admin, 'u-1', 'Fraud');

    const [, notice] = noticeFor(notifications);
    expect(notice.title).toBe('Your account has been banned');
    expect(notice.email?.transactional).toBe(true);
  });

  it('tells a reinstated user, without the staff reason', async () => {
    const { service, notifications } = setup(
      member({ account_status: AccountStatus.SUSPENDED, is_active: false }),
    );

    await service.reinstate(moderator, 'u-1', 'internal note');

    const [, notice] = noticeFor(notifications);
    expect(notice.title).toBe('Your account is active again');
    expect(JSON.stringify(notice)).not.toContain('internal note');
  });

  it('tells each user whose suspension ran out', async () => {
    const { service, notifications } = setup(null, [
      { id: 'u-1' },
      { id: 'u-2' },
    ]);

    await service.liftExpiredSuspensions();

    const calls = notifications.notify.mock.calls;
    expect(calls.map(([id]) => id)).toEqual(['u-1', 'u-2']);
    expect(calls[0][1].body).toContain('Your suspension has ended.');
  });

  it('tells no one when the suspension lost a race', async () => {
    const { service, userService, notifications } = setup(member());
    userService.setAccountState.mockResolvedValueOnce(false);

    await expect(service.suspend(moderator, 'u-1', 'Spam')).rejects.toThrow();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
