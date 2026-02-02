import { SetMetadata } from '@nestjs/common';

export const AllowSuspended = () => SetMetadata('allowSuspended', true);
