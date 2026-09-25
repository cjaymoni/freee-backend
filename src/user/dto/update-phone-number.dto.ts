import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePhoneNumberDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1...',
    description:
      'A Firebase ID token refreshed after the phone number was changed in Firebase',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
