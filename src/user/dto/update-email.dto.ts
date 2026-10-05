import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateEmailDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1...',
    description:
      'A Firebase ID token refreshed after a verified email was linked to the Firebase account',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
