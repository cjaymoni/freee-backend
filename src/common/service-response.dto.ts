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

  @ApiPropertyOptional()
  error?: string;

  @ApiPropertyOptional()
  errors?: any[];
}
