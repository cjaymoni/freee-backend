import { ApiProperty } from '@nestjs/swagger';

export class MarkReadResponseDto {
  @ApiProperty({ format: 'uuid' })
  conversation_id: string;

  @ApiProperty({ description: 'How many messages this call marked as read.' })
  marked_count: number;

  @ApiProperty({ type: [String], description: 'Ids of the messages marked.' })
  message_ids: string[];

  @ApiProperty()
  read_at: Date;
}
