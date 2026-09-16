import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The other participant as shown in the chat list and thread header.
 *
 * Deliberately a hand-built subset of UserEntity: assigning the loaded
 * relation wholesale would put every user column - password_hash included -
 * on the wire, and would silently do so again for any column added later.
 */
export class ChatUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  profile_image: string | null;

  @ApiProperty({ description: 'Whether the user currently has a live socket.' })
  is_online: boolean;

  @ApiPropertyOptional({ nullable: true })
  last_active: Date | null;
}
