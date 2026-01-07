import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FirebaseLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1...',
    description: 'Firebase ID Token',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
