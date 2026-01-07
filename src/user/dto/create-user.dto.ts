import { ApiProperty, PickType } from '@nestjs/swagger';
import { BaseUserDto } from './base-user.dto';
import { IsOptional } from 'class-validator';

export class CreateUserDto extends PickType(BaseUserDto, [
  'first_name',
  'last_name',
  'email',
  'phone_number',

  'gender',
  'bio',

  'date_of_birth',
  'password',
]) {
  @IsOptional()
  firebase_uid?: string;

  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  file?: any;
}
