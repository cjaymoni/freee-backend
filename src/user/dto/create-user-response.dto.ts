import { ApiProperty } from '@nestjs/swagger';
import { ServiceResponseDto } from 'src/common/service-response.dto';
import { UserResponseDto } from './user-response.dto';

export class CreateUserResponseDto {
  @ApiProperty({ example: true })
  state: boolean;

  @ApiProperty({ type: UserResponseDto })
  data: UserResponseDto;

  @ApiProperty({ example: 'User created successfully' })
  message: string;

  @ApiProperty({ example: 201 })
  statusCode: number;

  @ApiProperty({ required: false })
  error?: string;

  @ApiProperty({ required: false, type: [Object] })
  errors?: any[];
}
