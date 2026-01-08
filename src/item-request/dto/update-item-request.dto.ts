import { IsEnum, IsOptional, IsDateString, IsString } from 'class-validator';
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
    description: 'Pickup date (YYYY-MM-DD)',
    example: '2026-01-15',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  pickup_date?: string;

  @ApiProperty({
    description: 'Pickup time (HH:MM)',
    example: '14:30',
    required: false,
  })
  @IsOptional()
  @IsString()
  pickup_time?: string;
}
