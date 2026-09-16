import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryMessagesDto {
  @ApiPropertyOptional({
    description:
      'Return messages strictly older than this message id. Omit for the newest page.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'before must be a valid message UUID' })
  before?: string;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
