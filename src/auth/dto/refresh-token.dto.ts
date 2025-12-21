import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ example: 'your_refresh_token_here' })
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}
