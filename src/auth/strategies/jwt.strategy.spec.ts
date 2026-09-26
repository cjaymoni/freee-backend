import { ConfigService } from '@nestjs/config';
import { AccountStatus } from '../../user/entities/user.entity';
import { AuthService } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const payload = {
    sub: 'u1',
    email: 'a@b.c',
    role: 'USER',
    session_token: 'tok',
  };
  const build = (user: object | null) =>
    new JwtStrategy(
      { get: () => 'secret' } as unknown as ConfigService,
      {
        validateSession: jest.fn().mockResolvedValue(true),
        getUserForValidation: jest.fn().mockResolvedValue(user),
      } as unknown as AuthService,
    );

  it("passes the account's status on, so the guard can refuse bans", async () => {
    const strategy = build({
      is_active: false,
      account_status: AccountStatus.BANNED,
    });

    await expect(strategy.validate(payload as never)).resolves.toMatchObject({
      id: 'u1',
      is_active: false,
      account_status: AccountStatus.BANNED,
    });
  });

  it('treats a user it cannot load as active, as it does is_active', async () => {
    const strategy = build(null);

    await expect(strategy.validate(payload as never)).resolves.toMatchObject({
      is_active: true,
      account_status: AccountStatus.ACTIVE,
    });
  });
});
