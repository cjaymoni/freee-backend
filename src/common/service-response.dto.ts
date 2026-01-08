import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ServiceResponseDto<T> {
  @ApiProperty({ example: true })
  state: boolean;

  @ApiProperty()
  data: T;

  @ApiProperty({ example: 'operation successful' })
  message: string;

  @ApiProperty({ example: 200 })
  statusCode?: number;

  @ApiPropertyOptional({ description: 'Total count for paginated responses' })
  total?: number;

  @ApiPropertyOptional({
    description: 'Current page number for paginated responses',
  })
  page?: number;

  @ApiPropertyOptional({ description: 'Page size for paginated responses' })
  limit?: number;

  @ApiPropertyOptional()
  error?: string;

  @ApiPropertyOptional()
  errors?: any[];
}
