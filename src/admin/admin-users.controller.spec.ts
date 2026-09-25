import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../user/entities/user.entity';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { ChangeRoleDto } from './dto/change-role.dto';

describe('AdminUsersController', () => {
  it('passes the signed-in admin as the actor', async () => {
    const changeRole = jest.fn().mockResolvedValue({ state: true });
    const controller = new AdminUsersController({
      changeRole,
    } as unknown as AdminUsersService);
    const request = {} as Request;

    await controller.changeRole(
      'target',
      { role: UserRole.MODERATOR, reason: 'Joining mods' },
      'admin-1',
      UserRole.ADMIN,
      request,
    );

    expect(changeRole).toHaveBeenCalledWith(
      { userId: 'admin-1', role: UserRole.ADMIN },
      'target',
      UserRole.MODERATOR,
      'Joining mods',
      request,
    );
  });

  describe('ChangeRoleDto', () => {
    const pipe = new ValidationPipe({ whitelist: true });
    const meta: ArgumentMetadata = { type: 'body', metatype: ChangeRoleDto };

    it.each(Object.values(UserRole))('accepts %s', async (role) => {
      await expect(pipe.transform({ role }, meta)).resolves.toMatchObject({
        role,
      });
    });

    it.each([{ role: 'OWNER' }, {}, { role: 'USER', reason: 'x'.repeat(501) }])(
      'rejects %j',
      async (body) => {
        await expect(pipe.transform(body, meta)).rejects.toMatchObject({
          status: 400,
        });
      },
    );
  });
});
