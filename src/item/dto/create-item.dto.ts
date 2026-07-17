import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsUUID,
  IsDate,
  MaxLength,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ItemCondition, PickupType } from '../entities/item.entity';

export class CreateItemDto {
  @ApiProperty({ description: 'Item title', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ description: 'Item description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Category ID' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  @IsOptional()
  category_id?: string;

  @ApiProperty({
    description: 'Item condition. Note: items with condition "used" cannot be requested.',
    enum: ItemCondition,
    enumName: 'ItemCondition',
  })
  @IsEnum(ItemCondition)
  condition: ItemCondition;

  @ApiPropertyOptional({
    description: 'Item price (set to 0 if free)',
    default: 0,
    minimum: 0,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional({ description: 'Whether the item is free', default: true })
  @Transform(({ value }) => {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  is_free?: boolean;

  @ApiPropertyOptional({ description: 'Quantity available', default: 1, minimum: 1 })
  @Transform(({ value }) => (value !== undefined && value !== '' ? Number(value) : value))
  @IsNumber()
  @IsOptional()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Location ID from saved locations or temporary location',
  })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  @IsOptional()
  location_id?: string;

  @ApiPropertyOptional({ description: 'Pickup date' })
  @Transform(({ value }) => {
    if (!value || value === '') return undefined;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  })
  @IsDate()
  @IsOptional()
  pickup_date?: Date;

  @ApiPropertyOptional({ description: 'Pickup time (HH:MM)' })
  @IsString()
  @IsOptional()
  pickup_time?: string;

  @ApiPropertyOptional({ description: 'Pickup type', enum: PickupType, enumName: 'PickupType' })
  @IsEnum(PickupType)
  @IsOptional()
  pickup_type?: PickupType;
}
