import { PickType } from '@nestjs/swagger';
import { BaseUserDto } from '../../user/dto/base-user.dto';

export class ItemUserDto extends PickType(BaseUserDto, [
  'id',
  'first_name',
  'last_name',
  'phone_number',
  'cloudinary_avatar_url',
  'member_since',
] as const) {
  items_count: number;
}
