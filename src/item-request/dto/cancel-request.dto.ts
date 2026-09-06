import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelRequestDto {
  /**
   * Optional: item_requests.cancellation_reason is nullable, and a cancel
   * action in the client is not always able to collect a reason. Requiring it
   * here made an otherwise valid cancellation fail validation with a 400.
   */
  @ApiPropertyOptional({
    description: 'Reason for cancellation',
    example: 'No longer needed',
  })
  @IsOptional()
  @IsString()
  cancellation_reason?: string;
}
