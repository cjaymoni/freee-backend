import { IsUUID, IsString, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReportPriority } from './create-reported-item.dto';

export class CreateReportedUserDto {
  @ApiProperty({ description: 'ID of the user being reported' })
  @IsUUID()
  reportedUserId: string;

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
