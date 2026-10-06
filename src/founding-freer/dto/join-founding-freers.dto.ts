import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class JoinFoundingFreersDto {
  @ApiPropertyOptional({
    description: 'Only set if the account has no name yet',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  first_name?: string;

  @ApiPropertyOptional({
    description: 'Only set if the account has no name yet',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;
}
