import { ApiProperty } from '@nestjs/swagger';

export class UnreadCountResponseDto {
  @ApiProperty({
    description: 'Unread messages across every conversation - the tab badge.',
    example: 3,
  })
  total_unread: number;

  @ApiProperty({
    description: 'Number of conversations holding at least one unread message.',
    example: 2,
  })
  conversations_with_unread: number;
}
