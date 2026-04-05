import {
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  IsIn,
  IsArray,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserPreferenceDto {
  @ApiPropertyOptional({
    description: 'Preferred category IDs',
    example: ['uuid1', 'uuid2'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  preferred_category_ids?: string[];

  @ApiPropertyOptional({
    description: 'Notification settings as a JSON object',
    example: { email: true, push: true, sms: false },
  })
  @IsOptional()
  @IsObject()
  notification_settings?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Preferred language (ISO 639-1 code)',
    example: 'en',
    maxLength: 10,
    default: 'en',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional({
    description: 'Preferred theme',
    example: 'dark',
    enum: ['light', 'dark', 'auto'],
    default: 'light',
  })
  @IsOptional()
  @IsString()
  @IsIn(['light', 'dark', 'auto'])
  theme?: string;
}
