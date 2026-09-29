import { IsFcmToken } from '../../notification/device-tokens';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FirebaseLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1...',
    description: 'Firebase ID Token',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiPropertyOptional({
    description:
      "This device's FCM token. Registers it for push on the new session, " +
      'as PATCH /user/fcm-token would. Mobile clients must always send it: ' +
      'a session without one gets no pushes. See docs/CHAT_MODULE.md.',
  })
  @IsOptional()
  @IsFcmToken()
  fcm_token?: string;
}
