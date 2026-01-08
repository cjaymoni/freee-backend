import {
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserPreferenceDto {
  @ApiPropertyOptional({
    description: 'Preferred categories as a JSON object',
    example: { sports: true, technology: true, entertainment: false },
  })
  @IsOptional()
  @IsObject()
  preferred_categories?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Notification settings as a JSON object',
    example: {
      email: true,
      push: true,
      sms: false,
      marketing: false,
    },
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
