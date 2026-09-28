import {
  INestApplication,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { RejectNullBytesPipe } from './common/pipes/reject-null-bytes.pipe';

/**
 * The pipes every HTTP request and chat socket payload goes through, in
 * order. NUL is refused first: Postgres rejects it in text, so it would
 * otherwise surface as a 500.
 */
export function createGlobalPipes(): PipeTransform[] {
  return [
    new RejectNullBytesPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  ];
}

/**
 * The pipes and filter every request goes through. Shared with the tests
 * that drive HTTP, so they exercise exactly what production runs: query
 * parsing depends on these settings, `transform` in particular.
 */
export function configureGlobals(app: INestApplication): void {
  app.useGlobalPipes(...createGlobalPipes());

  // Every HTTP error in the documented ApiError shape.
  app.useGlobalFilters(new ApiExceptionFilter());
}
