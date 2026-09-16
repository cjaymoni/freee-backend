import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType, SystemEvent } from '../entities/message.entity';

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  conversation_id: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'For system messages, the user whose action triggered the event.',
  })
  sender_id: string;

  @ApiProperty({ format: 'uuid' })
  recipient_id: string;

  @ApiProperty({
    description: 'True when the authenticated user sent this message.',
  })
  is_mine: boolean;

  @ApiProperty({ enum: MessageType })
  message_type: MessageType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null for image-only and system messages.',
  })
  content: string | null;

  @ApiPropertyOptional({
    enum: SystemEvent,
    nullable: true,
    description:
      'Set on system messages. Render the wording from this plus is_mine.',
  })
  system_event: SystemEvent | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Snapshot of the item and request a system message refers to.',
    example: {
      item_id: '0b0c...',
      item_title: 'Red USB cable with headphones',
      item_image_url: 'https://res.cloudinary.com/...',
      request_id: '7f21...',
    },
  })
  metadata: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  image_url: string | null;

  @ApiPropertyOptional({ nullable: true })
  image_width: number | null;

  @ApiPropertyOptional({ nullable: true })
  image_height: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the recipient read it. Null while unread.',
  })
  read_at: Date | null;

  @ApiProperty({ description: 'Convenience flag mirroring read_at.' })
  is_read: boolean;

  @ApiProperty({
    description:
      'True once the sender deletes it. Content and image are stripped.',
  })
  is_deleted: boolean;

  @ApiProperty()
  created_at: Date;
}
