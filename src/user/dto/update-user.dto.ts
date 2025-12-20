import { OmitType, PartialType } from '@nestjs/swagger';
import { BaseUserDto } from './base-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(BaseUserDto, ['id', 'deleted_by'] as const),
) {}
