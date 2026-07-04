import {
  IsUUID,
  IsNotEmpty,
  IsDateString,
  IsOptional,
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
    description: 'Preferred pickup datetime (ISO 8601)',
    example: '2026-06-28T16:28:43.399Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  pickup_date?: string;
}
