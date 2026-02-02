import { IsString, IsOptional, IsUUID, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ComplaintType {
  BLOCKED = 'blocked',
  REPORTED = 'reported',
  ITEM_REMOVED = 'item_removed',
  ACCOUNT_SUSPENDED = 'account_suspended',
}

export class CreateComplaintDto {
  @ApiProperty({ enum: ComplaintType })
  @IsEnum(ComplaintType)
  complaintType: ComplaintType;

  @ApiProperty({ description: 'Reference ID of report/block', required: false })
  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @ApiProperty({ description: 'Subject of complaint', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  subject: string;

  @ApiProperty({ description: 'Detailed description of complaint' })
  @IsString()
  description: string;
}
