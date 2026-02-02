import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class ActiveUserGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowSuspended = this.reflector.get<boolean>(
      'allowSuspended',
      context.getHandler(),
    );

    if (allowSuspended) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Let auth guard handle this
    }

    if (user.is_active === false) {
      throw new ForbiddenException(
        'Your account has been suspended. You can only access complaint endpoints.',
      );
    }

    return true;
  }
}
