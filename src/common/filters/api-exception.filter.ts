import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import type { Response } from 'express';

/**
 * Give every HTTP error the documented `ApiError` shape
 * (docs/ANDROID_INTEGRATION.md §5, and ErrorResponseDto in Swagger):
 * `{ state: false, data: null, message, error, statusCode }`, whatever threw
 * it.
 *
 * Service errors already arrive that way through AppError. This covers the
 * rest - validation pipes, guards (401/403), unknown routes, the throttler and
 * uncaught errors - which Nest would otherwise answer without `state` and
 * often without `error`. Extra fields a response already carries (AppError's
 * `data: null`) are kept. Uncaught errors are logged and answered with a
 * generic 500, so internals never reach the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  private readonly wsFallback = new BaseWsExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.wsFallback.catch(exception, host);
      return;
    }

    const res = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        state: false,
        data: null,
        message: 'Internal server error',
        error: 'Internal Server Error',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      });
      return;
    }

    const status = exception.getStatus();
    const response = exception.getResponse();
    const body =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : { message: response };

    res.status(status).json({
      data: null,
      ...body,
      state: false,
      message: body.message ?? exception.message,
      error: body.error ?? defaultErrorName(status),
      statusCode: status,
    });
  }
}

/** "Not Found" for 404 and so on, matching Nest's own `error` values. */
function defaultErrorName(status: number): string {
  const key = HttpStatus[status];
  if (typeof key !== 'string') return 'Error';
  return key
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
