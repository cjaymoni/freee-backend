import { SetMetadata } from '@nestjs/common';

export const SKIP_PAGE_SIZE_KEY = 'skipPageSize';

/**
 * Exempts a handler from `platform.max_page_size`.
 *
 * For the handful of endpoints whose `limit` is not a page size - a number of
 * results to return, say - where the page cap would be both the wrong bound
 * and the wrong error message. The handler keeps whatever limit of its own it
 * already enforces.
 */
export const SkipPageSize = () => SetMetadata(SKIP_PAGE_SIZE_KEY, true);
