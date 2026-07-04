import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RequestStatus } from '../entities/item-request.entity';

export class UpdateItemRequestDto {
  @ApiProperty({
    description: 'Status of the request',
    enum: RequestStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  @ApiProperty({
    description: 'Pickup datetime (ISO 8601)',
    example: '2026-06-28T16:28:43.399Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  pickup_date?: string;
}
