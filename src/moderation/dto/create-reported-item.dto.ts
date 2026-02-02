import { IsUUID, IsString, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ReportPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export class CreateReportedItemDto {
  @ApiProperty({ description: 'ID of the item being reported' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ description: 'Reason for reporting', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  reason: string;

  @ApiProperty({ description: 'Detailed description', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ReportPriority, default: ReportPriority.MEDIUM, required: false })
  @IsOptional()
  @IsEnum(ReportPriority)
  priority?: ReportPriority;
}
