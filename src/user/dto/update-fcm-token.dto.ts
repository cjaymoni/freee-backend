import { IsFcmToken } from '../../notification/device-tokens';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFcmTokenDto {
  @ApiProperty({
    example: 'fcm-token-123456...',
    description: 'Firebase Cloud Messaging Token',
  })
  @IsFcmToken()
  fcm_token: string;
}
