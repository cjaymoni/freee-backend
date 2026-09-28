import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MAX_PAGE_LIMIT } from '../../common/assert-paging';

export class QueryMessagesDto {
  @ApiPropertyOptional({
    description:
      'Return messages strictly older than this message id. Omit for the newest page.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'before must be a valid message UUID' })
  before?: string;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: MAX_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number = 30;
}
