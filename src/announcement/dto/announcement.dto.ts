import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { toBoolean } from '../../common/to-boolean';
import { AnnouncementLevel } from '../entities/announcement.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAnnouncementDto {
  @ApiProperty({ maxLength: 280 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(280)
  message: string;

  @ApiPropertyOptional({ enum: AnnouncementLevel, default: 'info' })
  @IsOptional()
  @IsEnum(AnnouncementLevel)
  level?: AnnouncementLevel;

  @ApiPropertyOptional({
    description: 'Shown from (ISO 8601); now if left out',
  })
  @IsOptional()
  @IsDateString()
  active_from?: string;

  @ApiPropertyOptional({
    description: 'Shown until (ISO 8601); null or left out for no end',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  active_until?: string | null;

  @ApiPropertyOptional({ description: 'Off hides it whatever the dates' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}
