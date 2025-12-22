import { OmitType } from '@nestjs/swagger';
import { BaseUserDto } from './base-user.dto';

export class UserResponseDto extends OmitType(BaseUserDto, [
  'password',
] as const) {}
