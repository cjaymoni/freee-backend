import {
  IsUUID,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateItemRequestDto {
  @ApiProperty({
    description: 'ID of the item being requested',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({
    description: 'Preferred pickup date (YYYY-MM-DD)',
    example: '2026-01-15',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  pickup_date?: string;

  @ApiProperty({
    description: 'Preferred pickup time (HH:MM)',
    example: '14:30',
    required: false,
  })
  @IsOptional()
  @IsString()
  pickup_time?: string;
}
