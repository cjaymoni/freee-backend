import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { BaseUserDto } from './base-user.dto';

export class UserResponseDto extends OmitType(BaseUserDto, [
  'password',
  'fcm_token',
] as const) {
  /**
   * The deprecated users.fcm_token, copied in with the rest of the entity.
   * Never returned: a push token is a device secret, and someone holding
   * one could register it on their own session and take the pushes.
   */
  @Exclude()
  fcm_token?: string;

  // Response only: not on BaseUserDto, so profile updates can't set them.
  @ApiProperty({ description: 'Show the Founding Freer badge' })
  is_founding_freer: boolean;

  @ApiPropertyOptional({ nullable: true, type: Date })
  founding_freer_since: Date | null;
}
