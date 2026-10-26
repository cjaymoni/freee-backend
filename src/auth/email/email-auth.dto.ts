import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../common/email';

export class SendEmailCodeDto {
  @ApiProperty({ example: 'ama@example.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(255)
  email: string;
}

export class VerifyEmailCodeDto extends SendEmailCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;
}
