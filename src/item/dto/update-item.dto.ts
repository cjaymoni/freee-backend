import { PartialType } from '@nestjs/swagger';
import { CreateItemDto } from './create-item.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ItemStatus } from '../entities/item.entity';

export class UpdateItemDto extends PartialType(CreateItemDto) {
  @ApiPropertyOptional({
    description: 'Item status',
    enum: ItemStatus,
    enumName: 'ItemStatus',
  })
  @IsEnum(ItemStatus)
  @IsOptional()
  status?: ItemStatus;

  @ApiPropertyOptional({
    description:
      'IDs of existing images to remove from the item. Accepts a repeated field or a comma-separated string.',
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174000'],
  })
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const ids = Array.isArray(value) ? value : String(value).split(',');
    return ids.map((id) => String(id).trim()).filter((id) => id.length > 0);
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  remove_image_ids?: string[];
}
