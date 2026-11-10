import { BadRequestException } from '@nestjs/common';

/**
 * The largest page any list endpoint can serve. The `platform.max_page_size`
 * setting may lower it but never raise it: the DTOs validate against this
 * constant with decorators, which cannot read the database.
 */
export const MAX_PAGE_LIMIT = 100;

/**
 * page/limit arrive as parsed integers; bad values would reach OFFSET.
 *
 * Enforces the hard ceiling only. A lower `platform.max_page_size` set by
 * staff is applied by PageSizeInterceptor, which runs on every list endpoint
 * before this does, including the ones that validate paging through
 * PaginationDto.
 *
 * @throws BadRequestException when the page or limit is out of range.
 */
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
