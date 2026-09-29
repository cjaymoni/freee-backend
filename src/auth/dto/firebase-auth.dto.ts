import { IsFcmToken } from '../../notification/device-tokens';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FirebaseAuthDto {
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
      'as PATCH /users/fcm-token would.',
  })
  @IsOptional()
  @IsFcmToken()
  fcm_token?: string;
}
