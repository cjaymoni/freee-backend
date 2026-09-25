import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/pagination.dto';
import { BaseUserDto } from './base-user.dto';

/** Query strings arrive as text, so map "true"/"false" onto booleans. */
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class FindUserDto extends IntersectionType(
  PaginationDto,
  OmitType(BaseUserDto, [
    'is_active',
    'is_email_verified',
    'is_phone_verified',
    'notification_enabled',
  ] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_email_verified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_phone_verified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  notification_enabled?: boolean;
}
