import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController.logout', () => {
  it('ends the session named in the JWT', async () => {
    const authService = {
      logout: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    const controller = new AuthController(
      authService as unknown as AuthService,
    );

    // The shape JwtStrategy.validate puts on req.user.
    await controller.logout({ userId: 'u1', sessionToken: 'sess-1' });

    expect(authService.logout).toHaveBeenCalledWith('u1', 'sess-1');
  });
});
