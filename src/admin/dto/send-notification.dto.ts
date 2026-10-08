import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';
import { toBoolean } from '../../common/to-boolean';
import { NotificationAudience } from '../../notification/entities/admin-notification.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Who to send to. Also the query for counting them before sending. */
export class NotificationAudienceDto {
  @ApiProperty({ enum: NotificationAudience })
  @IsEnum(NotificationAudience)
  audience: NotificationAudience;

  @ApiPropertyOptional({ description: 'Required when audience is `user`' })
  @ValidateIf(
    (o: NotificationAudienceDto) => o.audience === NotificationAudience.USER,
  )
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({
    description:
      'With audience `location`: users with a saved location in this city. Give a city, a region or both.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'With audience `location`: region' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  region?: string;
}

export class SendNotificationDto extends NotificationAudienceDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;

  @ApiPropertyOptional({
    description: 'Also email it, to users who have an address and allow emails',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  send_email?: boolean;
}

export class NotificationHistoryQueryDto extends OmitType(PaginationDto, [
  'sortBy',
] as const) {}
