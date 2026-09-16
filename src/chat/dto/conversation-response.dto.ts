import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatUserDto } from './chat-user.dto';
import { ConversationItemContextDto } from './conversation-item-context.dto';
import { MessageResponseDto } from './message-response.dto';

export class ConversationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    type: ChatUserDto,
    description: 'The participant who is not the authenticated user.',
  })
  participant: ChatUserDto;

  @ApiPropertyOptional({
    type: ConversationItemContextDto,
    nullable: true,
    description: 'Item banner for the thread. Null for a plain direct chat.',
  })
  item: ConversationItemContextDto | null;

  @ApiPropertyOptional({ type: MessageResponseDto, nullable: true })
  last_message: MessageResponseDto | null;

  @ApiPropertyOptional({ nullable: true })
  last_message_at: Date | null;

  @ApiProperty({ description: "The authenticated user's unread count." })
  unread_count: number;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}
