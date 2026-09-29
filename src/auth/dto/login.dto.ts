import { IsFcmToken } from '../../notification/device-tokens';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { IsNotDisposableEmail } from '../../common/decorators/is-not-disposable-email.decorator';

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  @IsNotDisposableEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({
    description:
      "This device's FCM token. Registers it for push on the new session, " +
      'as PATCH /users/fcm-token would.',
  })
  @IsOptional()
  @IsFcmToken()
  fcm_token?: string;
}
