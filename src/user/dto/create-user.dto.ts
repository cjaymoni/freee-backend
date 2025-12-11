import { PickType } from '@nestjs/swagger';
import { BaseUserDto } from './base-user.dto';

export class CreateUserDto extends PickType(BaseUserDto, [
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'is_active',
  'is_verified',
  'account_locked_until',
  'failed_login_attempts',
  'last_password_change',
  'requires_password_change',
  'notification_enabled',
  'member_since',
  'last_active',
  'failed_login_attempts',
  'account_locked_until',
  'last_password_change',
  'requires_password_change',
  'notification_enabled',
  'member_since',
  'last_active',
  'phone_country_code',
  'gender',
  'bio',
  'cloudinary_avatar_public_id',
  'cloudinary_avatar_url',
  'date_of_birth',
  'password_hash',
  
]) {}