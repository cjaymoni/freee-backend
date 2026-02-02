import { IsUUID, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBlockedUserDto {
  @ApiProperty({ description: 'ID of the user to block' })
  @IsUUID()
  blockedId: string;

  @ApiProperty({ description: 'Reason for blocking', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
