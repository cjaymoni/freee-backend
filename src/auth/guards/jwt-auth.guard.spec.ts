import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AllowSuspended } from '../decorators/allow-suspended.decorator';

class Routes {
  normal() {}
  @AllowSuspended()
  complaint() {}
}

describe('JwtAuthGuard suspension check', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const passportCanActivate = jest.spyOn(
    // The passport half is out of scope: pretend the token was valid.
    Object.getPrototypeOf(JwtAuthGuard.prototype) as InstanceType<
      ReturnType<typeof AuthGuard>
    >,
    'canActivate',
  );

  const ctx = (handler: keyof Routes, is_active: boolean) =>
    ({
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => ({ user: { is_active } }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => passportCanActivate.mockResolvedValue(true));

  it('lets an active user through', async () => {
    await expect(guard.canActivate(ctx('normal', true))).resolves.toBe(true);
  });

  it('refuses a suspended user on a normal route', async () => {
    await expect(guard.canActivate(ctx('normal', false))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets a suspended user reach an @AllowSuspended route', async () => {
    await expect(guard.canActivate(ctx('complaint', false))).resolves.toBe(
      true,
    );
  });

  it('does not run the suspension check when the token is rejected', async () => {
    passportCanActivate.mockResolvedValue(false);
    await expect(guard.canActivate(ctx('normal', false))).resolves.toBe(false);
  });
});
