import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmPickupDto {
  @ApiProperty({
    description: 'Confirmation code for pickup',
    example: 'ABC123',
    minLength: 6,
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 10)
  confirmation_code: string;
}
