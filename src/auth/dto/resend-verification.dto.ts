import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { IsNotDisposableEmail } from '../../common/decorators/is-not-disposable-email.decorator';
import { NormalizeEmail } from '../../common/email';

export class ResendVerificationDto {
  @ApiProperty({ example: 'johndoe@gmail.com' })
  @IsEmail()
  @IsNotDisposableEmail()
  @NormalizeEmail()
  email: string;
}
