import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({
    description: 'The other participant. A thread is reused if one exists.',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'recipient_id must be a valid UUID' })
  recipient_id: string;

  @ApiPropertyOptional({
    description:
      'Item the conversation is about. Re-points an existing thread at this item rather than creating a second one.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'item_id must be a valid UUID' })
  item_id?: string;
}
