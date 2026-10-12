import { IsString, IsNotEmpty, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmPickupDto {
  @ApiProperty({
    description:
      'Pickup code the owner hands over at collection. Case and surrounding whitespace are ignored.',
    example: 'ABC123',
    minLength: 6,
    maxLength: 10,
  })
  // Codes are typed in from what the owner reads out or shows, so a lowercase
  // or padded entry is the same code, not a wrong one.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @Length(6, 10)
  confirmation_code: string;
}
