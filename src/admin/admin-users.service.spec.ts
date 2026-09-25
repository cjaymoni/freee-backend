import { DataSource } from 'typeorm';
import {
  AccountStatus,
  UserEntity,
  UserRole,
} from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { AdminAuditService } from './admin-audit.service';
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

const setup = (user: UserEntity | null, expired: UserEntity[] = []) => {
  const manager = { update: jest.fn().mockResolvedValue({}) };
  const userRepo = {
    findOne: jest.fn().mockResolvedValue(user),
    find: jest.fn().mockResolvedValue(expired),
  };
  const dataSource = {
    getRepository: () => userRepo,
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const userService = {
    update: jest.fn().mockResolvedValue({
      state: true,
      data: { id: 'u-1', role: UserRole.MODERATOR },
      message: 'User updated successfully',
      statusCode: 200,
    }),
    setAccountState: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const firebase = { revokeRefreshTokens: jest.fn().mockResolvedValue(true) };
  const service = new AdminUsersService(
    dataSource as unknown as DataSource,
    userService as unknown as UserService,
    audit as unknown as AdminAuditService,
    firebase as unknown as FirebaseService,
  );
  // detail() runs a dozen counts; the actions only need to reach it.
  jest.spyOn(service, 'detail').mockResolvedValue({ data: {} } as never);
  return { service, manager, userService, audit, firebase, userRepo };
};

const ends = { user: { id: 'u-1' }, is_active: true };

describe('AdminUsersService.changeRole', () => {
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
    const { service, userService, manager, audit } = setup(member());
    const until = later();

    await service.suspend(moderator, 'u-1', 'No-shows', until);

    expect(userService.setAccountState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
      {
        is_active: false,
        account_status: AccountStatus.SUSPENDED,
        status_reason: 'No-shows',
        suspended_until: new Date(until),
        status_changed_by: moderator.userId,
      },
    );
    // Suspended users keep their sessions so they can still appeal.
    expect(manager.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: moderator,
        action: USER_SUSPENDED,
        reason: 'No-shows',
      }),
    );
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
  it('bans, ends sessions and revokes Firebase tokens', async () => {
    const { service, userService, manager, firebase, audit } = setup(member());

    await service.ban(admin, 'u-1', 'Fraud');

    expect(userService.setAccountState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u-1' }),
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
    expect(firebase.revokeRefreshTokens).toHaveBeenCalledWith('fb-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: USER_BANNED, reason: 'Fraud' }),
    );
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

  it('refuses an account that is already active', async () => {
    const { service } = setup(member());

    await expect(service.reinstate(admin, 'u-1')).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('AdminUsersService.liftExpiredSuspensions', () => {
  it('reinstates suspensions past their end date, audited as the system', async () => {
    const expired = member({
      is_active: false,
      account_status: AccountStatus.SUSPENDED,
      suspended_until: new Date('2020-01-01'),
    });
    const { service, userService, audit } = setup(null, [expired]);

    await expect(service.liftExpiredSuspensions()).resolves.toBe(1);

    expect(userService.setAccountState).toHaveBeenCalledWith(
      expired,
      expect.objectContaining({
        is_active: true,
        account_status: AccountStatus.ACTIVE,
        status_changed_by: null,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null, action: USER_REINSTATED }),
    );
  });
});
