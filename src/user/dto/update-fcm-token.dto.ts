import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFcmTokenDto {
  @ApiProperty({
    example: 'fcm-token-123456...',
    description: 'Firebase Cloud Messaging Token',
  })
  @IsString()
  @IsNotEmpty()
  fcm_token: string;
}
