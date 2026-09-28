import { INestApplication } from '@nestjs/common';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { createGlobalPipes } from './common/pipes/global-pipes';

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
