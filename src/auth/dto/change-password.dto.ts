import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123!',
    description: 'Current user password',
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    example: 'NewPassword123!',
    description: 'New user password',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  newPassword: string;
}
