import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ComplaintStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
}

export class ResolveComplaintDto {
  @ApiProperty({ enum: ComplaintStatus })
  @IsEnum(ComplaintStatus)
  status: ComplaintStatus;

  @ApiProperty({ description: 'Admin response to complaint' })
  @IsString()
  adminResponse: string;
}
