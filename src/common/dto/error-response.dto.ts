import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: false })
  state: boolean;

  @ApiProperty({ example: null })
  data: any;

  @ApiProperty({ example: 'An error occurred' })
  message: string;

  @ApiProperty({ example: 'Internal Server Error' })
  error: string;

  @ApiProperty({ example: 500 })
  statusCode: number;
}
