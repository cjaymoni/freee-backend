import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SendSmsCodeDto {
  @ApiProperty({ example: '+233241234567', description: 'E.164 number' })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Enter a valid phone number.' })
  phone_number: string;
}

export class VerifySmsCodeDto extends SendSmsCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'Enter the code from the SMS.' })
  code: string;
}
