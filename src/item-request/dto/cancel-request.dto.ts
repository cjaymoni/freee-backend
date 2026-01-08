import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelRequestDto {
  @ApiProperty({
    description: 'Reason for cancellation',
    example: 'No longer needed',
  })
  @IsString()
  @IsNotEmpty()
  cancellation_reason: string;
}
