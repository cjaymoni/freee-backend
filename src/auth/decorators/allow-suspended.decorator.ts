import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_KEY = 'allowSuspended';

/** Lets a suspended (is_active=false) user through JwtAuthGuard. */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
