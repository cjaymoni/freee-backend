import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '../chat.constants';

export class SendMessageDto {
  @ApiPropertyOptional({
    description: 'Message body. Required unless an image is attached.',
    maxLength: MAX_MESSAGE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'content cannot be empty' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `content cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
  })
  content?: string;
}
