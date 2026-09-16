import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '../chat.constants';

/** Payload of the `message:send` client event. */
export class WsSendMessageDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'conversation_id must be a valid UUID' })
  conversation_id: string;

  @ApiProperty({ maxLength: MAX_MESSAGE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'content cannot be empty' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `content cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
  })
  content: string;

  @ApiPropertyOptional({
    description:
      'Client-generated id echoed back on the ack, so the sender can reconcile its optimistic bubble.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  client_message_id?: string;
}

/** Payload of the `message:read` client event. */
export class WsMarkReadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'conversation_id must be a valid UUID' })
  conversation_id: string;
}

/** Payload of the `typing:start` and `typing:stop` client events. */
export class WsTypingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'conversation_id must be a valid UUID' })
  conversation_id: string;
}

/** Payload of the server's `typing` event. */
export class TypingEventDto {
  @ApiProperty({ format: 'uuid' })
  conversation_id: string;

  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty()
  @IsBoolean()
  is_typing: boolean;

  @ApiProperty({
    description:
      'Milliseconds after which the client should clear the indicator if no stop arrives.',
  })
  timeout_ms: number;
}

/** Payload of the server's `presence` event. */
export class PresenceEventDto {
  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty()
  is_online: boolean;

  @ApiPropertyOptional({ nullable: true })
  last_active: Date | null;
}
