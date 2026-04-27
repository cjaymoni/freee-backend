import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    const authHeader = request?.headers?.authorization;

    if (!authHeader) {
      return true;
    }

    return super.canActivate(context);
  }
}
