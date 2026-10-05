import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';
import { IsNotDisposableEmail } from '../../common/decorators/is-not-disposable-email.decorator';
import { NormalizeEmail } from '../../common/email';

export class VerifyEmailDto {
  @ApiProperty()
  @IsEmail()
  @IsNotDisposableEmail()
  @NormalizeEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code: string;
}
