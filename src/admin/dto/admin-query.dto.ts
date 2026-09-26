import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';
import { AccountStatus, UserRole } from '../../user/entities/user.entity';
import { ItemStatus, ModerationStatus } from '../../item/entities/item.entity';
import { RequestStatus } from '../../item-request/entities/item-request.entity';

/** Query strings arrive as text, so map "true"/"false" onto booleans. */
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Name, email or phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  account_status?: AccountStatus;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Joined on or after (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  created_from?: string;

  @ApiPropertyOptional({ description: 'Joined before (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  created_to?: string;
}

export class AdminItemQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Title or description' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Sharer (owner) user ID' })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ enum: ItemStatus })
  @IsOptional()
  @IsEnum(ItemStatus)
  status?: ItemStatus;

  @ApiPropertyOptional({ enum: ModerationStatus })
  @IsOptional()
  @IsEnum(ModerationStatus)
  moderation_status?: ModerationStatus;

  @ApiPropertyOptional({ description: 'City of the pickup location' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Area of the pickup location' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  area?: string;

  @ApiPropertyOptional({
    description: 'true: only listings with requests; false: only without',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  has_requests?: boolean;

  @ApiPropertyOptional({ description: 'Include removed listings' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  include_deleted?: boolean;
}

export class AdminUserRequestsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['made', 'received'],
    description: 'Requests the user made, or received on their listings',
  })
  @IsOptional()
  @IsIn(['made', 'received'])
  direction?: 'made' | 'received';

  @ApiPropertyOptional({ enum: RequestStatus })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
}
