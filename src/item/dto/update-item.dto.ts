import { PartialType } from '@nestjs/swagger';
import { CreateItemDto } from './create-item.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ItemStatus } from '../entities/item.entity';

export class UpdateItemDto extends PartialType(CreateItemDto) {
  @ApiPropertyOptional({
    description: 'Item status',
    enum: ItemStatus,
  })
  @IsEnum(ItemStatus)
  @IsOptional()
  status?: ItemStatus;
}
