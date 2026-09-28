import { BadRequestException } from '@nestjs/common';

/** The largest page any list endpoint serves. */
export const MAX_PAGE_LIMIT = 100;

/** page/limit arrive as parsed integers; bad values would reach OFFSET. */
export function assertPaging(page: number, limit: number): void {
  if (page < 1) {
    throw new BadRequestException('page must be a positive integer');
  }
  if (limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new BadRequestException(
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
    );
  }
}
