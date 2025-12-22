import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';
import { IsNotDisposableEmail } from '../../common/decorators/is-not-disposable-email.decorator';

export class VerifyEmailDto {
  @ApiProperty()
  @IsEmail()
  @IsNotDisposableEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @Length(6, 6)
  code: string;
}
