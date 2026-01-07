import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { BaseUserDto } from './base-user.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateUserDto extends PartialType(
  OmitType(BaseUserDto, ['id', 'deleted_by'] as const),
) {
  @ApiProperty({ required: false, example: 'firebase-uid-123' })
  @IsOptional()
  @IsString()
  firebase_uid?: string;
}
