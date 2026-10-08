import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { UpdateItemDto } from '../../item/dto/update-item.dto';

/**
 * What an admin may change on someone else's listing: its content and
 * pickup details, and removing photos. Price and location stay the owner's.
 */
export class AdminUpdateItemDto extends PickType(UpdateItemDto, [
  'title',
  'description',
  'category_id',
  'condition',
  'quantity',
  'status',
  'pickup_type',
  'pickup_date',
  'pickup_time',
  'remove_image_ids',
] as const) {
  @ApiPropertyOptional({
    description: 'Why; saved in the audit log and told to the owner',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
