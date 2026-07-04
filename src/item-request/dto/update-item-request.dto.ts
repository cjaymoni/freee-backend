import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RequestStatus } from '../entities/item-request.entity';

export class UpdateItemRequestDto {
  @ApiProperty({
    description: 'Status of the request',
    enum: RequestStatus,
    enumName: 'RequestStatus',
    required: false,
  })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
}
