import {
  ApiPropertyOptional,
  IntersectionType,
  PickType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/pagination.dto';
import { toBoolean } from 'src/common/to-boolean';
import { BaseUserDto } from './base-user.dto';

/**
 * Exact-match filters for the staff user list. Only profile fields are
 * listed: secrets (password, fcm_token) and bookkeeping columns must not be
 * queryable, and every field that is not a string needs converting from the
 * query string or it can never validate.
 */
export class FindUserDto extends IntersectionType(
  PaginationDto,
  PickType(BaseUserDto, [
    'id',
    'phone_number',
    'email',
    'first_name',
    'last_name',
    'role',
    'gender',
    'date_of_birth',
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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_onboarded?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  requires_password_change?: boolean;
}
