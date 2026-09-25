import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '../../user/entities/user.entity';

export class ChangeRoleDto {
  @ApiProperty({ enum: UserRole, example: UserRole.MODERATOR })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ example: 'Joining the moderation team' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
