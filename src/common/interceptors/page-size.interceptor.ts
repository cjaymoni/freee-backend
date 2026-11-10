import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { AppError } from '../app-error';
import { SKIP_PAGE_SIZE_KEY } from '../decorators/skip-page-size.decorator';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';

/**
 * Refuses a list request asking for a bigger page than staff allow.
 *
 * Applied globally because the limit is enforced two different ways across
 * the app - PaginationDto's `@Max` on most endpoints, assertPaging on the
 * rest - and neither a decorator nor a pure function can read a setting. The
 * DTOs still carry the hard ceiling; this only applies the lower bar an admin
 * may have set.
 *
 * An interceptor rather than a guard: global guards run before the route's
 * own, so a guard here would answer 400 to an unauthenticated caller that
 * JwtAuthGuard was about to answer 401, telling a stranger the configured
 * page cap. Interceptors run after every guard and before the pipes, which is
 * exactly the window this needs.
 *
 * A limit that is not a whole number is left alone: the DTO's own validation
 * gives a better message for it than this could. Handlers whose `limit` means
 * something other than a page size opt out with {@link SkipPageSize}.
 */
@Injectable()
export class PageSizeInterceptor implements NestInterceptor {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_PAGE_SIZE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const { limit } = context.switchToHttp().getRequest<Request>().query;
    if (typeof limit === 'string' && /^\d+$/.test(limit)) {
      const max = this.settings.get('platform.max_page_size');
      if (Number(limit) > max) {
        throw new AppError(
          new BadRequestException(
            `limit must be an integer between 1 and ${max}`,
          ),
        );
      }
    }
    return next.handle();
  }
}
