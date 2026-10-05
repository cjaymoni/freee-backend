import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NormalizeEmail } from '../../common/email';

export class FirebaseEmailDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'The email address to send the Firebase link to',
  })
  @IsEmail()
  @IsNotEmpty()
  @NormalizeEmail()
  email: string;
}
