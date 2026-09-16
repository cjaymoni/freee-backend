import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemStatus } from '../../item/entities/item.entity';
import { RequestStatus } from '../../item-request/entities/item-request.entity';

/**
 * The item banner pinned above the message list: thumbnail, title and where
 * the handover has got to.
 */
export class ConversationItemContextDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true, description: 'Primary item image.' })
  image_url: string | null;

  @ApiProperty({ enum: ItemStatus })
  status: ItemStatus;

  @ApiProperty({
    format: 'uuid',
    description: 'Owner of the item - one of the two participants.',
  })
  owner_id: string;

  @ApiProperty({
    description: 'True when the authenticated user owns the item.',
  })
  is_mine: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Most recent request between these two users for this item, if any.',
  })
  request_id: string | null;

  @ApiPropertyOptional({ enum: RequestStatus, nullable: true })
  request_status: RequestStatus | null;

  @ApiProperty({
    description:
      'True while a request is open and the item has not been handed over.',
  })
  is_pending_pickup: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set once the requester confirms pickup.',
  })
  picked_up_at: Date | null;
}
