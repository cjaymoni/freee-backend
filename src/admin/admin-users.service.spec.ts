import { DataSource } from 'typeorm';
import { UserRole } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersService, ROLE_CHANGED } from './admin-users.service';

const admin = { userId: 'admin-1', role: UserRole.ADMIN };

const setup = (user: object | null) => {
  const manager = { update: jest.fn().mockResolvedValue({}) };
  const dataSource = {
    getRepository: () => ({ findOne: jest.fn().mockResolvedValue(user) }),
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const userService = {
    update: jest.fn().mockResolvedValue({
      state: true,
      data: { id: 'u-1', role: UserRole.MODERATOR },
      message: 'User updated successfully',
      statusCode: 200,
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminUsersService(
    dataSource as unknown as DataSource,
    userService as unknown as UserService,
    audit as unknown as AdminAuditService,
  );
  return { service, manager, userService, audit };
};

describe('AdminUsersService.changeRole', () => {
  it('changes the role, ends sessions and audits the change', async () => {
    const { service, manager, userService, audit } = setup({
      id: 'u-1',
      role: UserRole.USER,
    });

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
    expect(manager.update).toHaveBeenCalledWith(
      UserSessionEntity,
      { user: { id: 'u-1' }, is_active: true },
      { is_active: false },
    );
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
    const { service, userService } = setup({
      id: admin.userId,
      role: UserRole.ADMIN,
    });

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
    const { service, audit } = setup({ id: 'u-1', role: UserRole.MODERATOR });

    await expect(
      service.changeRole(admin, 'u-1', UserRole.MODERATOR),
    ).rejects.toMatchObject({ status: 400 });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
