import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ReportStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum ActionTaken {
  ITEM_REMOVED = 'item_removed',
  USER_WARNED = 'user_warned',
  NO_ACTION = 'no_action',
}

export class ResolveReportDto {
  @ApiProperty({ enum: ReportStatus })
  @IsEnum(ReportStatus)
  status: ReportStatus;

  @ApiProperty({ description: 'Resolution notes', required: false })
  @IsOptional()
  @IsString()
  resolutionNotes?: string;

  @ApiProperty({ enum: ActionTaken, required: false })
  @IsOptional()
  @IsEnum(ActionTaken)
  actionTaken?: ActionTaken;
}
