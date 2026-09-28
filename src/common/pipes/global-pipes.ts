import { PipeTransform, ValidationPipe } from '@nestjs/common';
import { RejectNullBytesPipe } from './reject-null-bytes.pipe';

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
