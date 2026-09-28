import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../app-error';

/**
 * Refuses a request that repeats any of `names` in its query string.
 *
 * Express turns `?a=1&a=2` into an array. The global pipe would flatten it
 * to "1,2", and ParseUUIDPipe/ParseEnumPipe would reject it with a message
 * about the format instead. A guard runs before every pipe, so each of these
 * filters gets the same, accurate answer.
 */
export function SingleValueQuery(names: readonly string[]): Type<CanActivate> {
  @Injectable()
  class SingleValueQueryGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const { query } = context.switchToHttp().getRequest<Request>();
      const repeated = names.find((name) => Array.isArray(query[name]));
      if (repeated) {
        throw new AppError(
          new BadRequestException(`${repeated} must be sent only once`),
        );
      }
      return true;
    }
  }
  return mixin(SingleValueQueryGuard);
}
