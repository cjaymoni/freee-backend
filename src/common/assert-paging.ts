import { BadRequestException } from '@nestjs/common';

/** page/limit arrive as parsed integers; bad values would reach OFFSET. */
export function assertPaging(page: number, limit: number): void {
  if (page < 1) {
    throw new BadRequestException('page must be a positive integer');
  }
  if (limit < 1 || limit > 100) {
    throw new BadRequestException('limit must be between 1 and 100');
  }
}
