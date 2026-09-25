import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_SUSPENDED_KEY } from '../decorators/allow-suspended.decorator';

/**
 * Authenticates the bearer token and then refuses suspended / deactivated
 * accounts (is_active=false) unless the route or controller is marked
 * @AllowSuspended(). Doing this here rather than in a separate guard means
 * every JWT-protected route enforces suspension without opting in.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const allowSuspended = this.reflector.getAllAndOverride<boolean>(
      ALLOW_SUSPENDED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowSuspended) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: { is_active?: boolean } }>().user;
    if (user?.is_active === false) {
      throw new ForbiddenException(
        'Your account has been suspended. You can only access complaint endpoints.',
      );
    }
    return true;
  }
}
