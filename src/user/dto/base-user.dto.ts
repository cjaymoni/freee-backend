import {
  IsString,
  IsEmail,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsUrl,
  IsUUID,
  IsInt,
  MaxLength,
  MinLength,
  Matches,
  Min,
  IsPhoneNumber,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BaseUserDto {
  @ApiProperty({
    description: 'User ID',
    required: false,
    type: String,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ required: false, example: '+233243225121' })
  @IsPhoneNumber()
  @IsOptional()
  phone_number?: string;

  @ApiProperty({ required: false, example: '+233' })
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  @Matches(/^\+\d{1,4}$/, {
    message: 'Phone country code must start with + followed by 1-4 digits',
  })
  phone_country_code?: string;

  @ApiProperty({ required: false, example: 'judeclottey@gmail.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiProperty({
    example: 'password',
  })
  @IsString()
  @IsOptional()
  password_hash?: string;

  @ApiProperty({ required: false, example: 'Jude' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @ApiProperty({ required: false, example: 'Clottey' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @ApiProperty({ required: false, example: '2000-01-01' })
  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @ApiProperty({ required: false, example: 'Male' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiProperty({
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cloudinary_avatar_public_id?: string;

  @ApiProperty({ required: false, example: 'https://example.com/avatar.jpg' })
  @IsOptional()
  @IsUrl()
  cloudinary_avatar_url?: string;

  @ApiProperty({ required: false, example: 'I am a bio' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  member_since?: Date;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  last_active?: Date;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  is_verified?: boolean;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  notification_enabled?: boolean;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  is_deleted?: boolean;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  deleted_at?: Date;

  @ApiProperty({
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  deleted_by?: string;

  @ApiProperty({ required: false, example: 'I deleted this user' })
  @IsOptional()
  @IsString()
  deletion_reason?: string;

  @ApiProperty({ required: false, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  failed_login_attempts?: number;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  account_locked_until?: Date;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  last_password_change?: Date;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  requires_password_change?: boolean;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  created_at?: Date;

  @ApiProperty({ required: false, example: '2022-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }: { value: unknown }) =>
    value ? new Date(value as string | number | Date).toISOString() : null,
  )
  updated_at?: Date;
}
