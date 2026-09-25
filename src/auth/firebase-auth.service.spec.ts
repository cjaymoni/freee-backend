import { ForbiddenException } from '@nestjs/common';
import { FirebaseAuthService } from './firebase-auth.service';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { UserRole } from '../user/entities/user.entity';

const revoke = jest.fn().mockResolvedValue(undefined);
jest.mock('firebase-admin', () => ({
  auth: () => ({ revokeRefreshTokens: revoke }),
}));

describe('FirebaseAuthService.revokeRefreshTokens', () => {
  const victim = { id: 'victim', firebase_uid: 'fb-victim' };
  const userService = { findByEmail: jest.fn() };
  const service = new FirebaseAuthService(
    {} as MailService,
    userService as unknown as UserService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userService.findByEmail.mockResolvedValue(victim);
  });

  it("refuses to revoke another user's sessions", async () => {
    await expect(
      service.revokeRefreshTokens('victim@example.com', {
        userId: 'attacker',
        role: UserRole.USER,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('answers an unknown email the same way for non-admins', async () => {
    userService.findByEmail.mockResolvedValue(null);
    await expect(
      service.revokeRefreshTokens('nobody@example.com', {
        userId: 'attacker',
        role: UserRole.USER,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a user revoke their own sessions', async () => {
    await service.revokeRefreshTokens('victim@example.com', {
      userId: 'victim',
      role: UserRole.USER,
    });
    expect(revoke).toHaveBeenCalledWith('fb-victim');
  });

  it("lets an admin revoke anyone's sessions", async () => {
    await service.revokeRefreshTokens('victim@example.com', {
      userId: 'admin',
      role: UserRole.ADMIN,
    });
    expect(revoke).toHaveBeenCalledWith('fb-victim');
  });
});
