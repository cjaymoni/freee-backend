import { ApiProperty, PickType } from '@nestjs/swagger';
import { BaseUserDto } from './base-user.dto';
import {
  IsOptional,
  IsUUID,
  IsArray,
} from 'class-validator';
import { Transform } from 'class-transformer';

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

  @ApiProperty({ type: [String], required: false, description: 'Preferred category IDs' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value].filter(Boolean)))
  @IsArray()
  @IsUUID('4', { each: true })
  category_ids?: string[];
}
