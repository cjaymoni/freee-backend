import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RequestStatus } from '../entities/item-request.entity';
import { ItemResponseDto } from '../../item/dto/item-response.dto';
import { ItemUserDto } from '../../item/dto/item-user.dto';

export class ItemRequestResponseDto {
  @ApiProperty({ description: 'Request ID' })
  id: string;

  @ApiProperty({ description: 'Item ID being requested' })
  item_id: string;

  @ApiProperty({ description: 'User ID of the requester' })
  requester_id: string;

  @ApiProperty({ description: 'User ID of the item owner' })
  owner_id: string;

  @ApiProperty({
    description: 'Current status of the request',
    enum: RequestStatus,
    enumName: 'RequestStatus',
  })
  status: RequestStatus;

  @ApiPropertyOptional({
    description: 'Scheduled pickup date',
    type: String,
    example: '2026-06-28T16:28:43.399Z',
  })
  pickup_date?: Date | null;

  @ApiPropertyOptional({
    description:
      'Deprecated: the code-entry pickup is switched off in favour of both parties tapping "Picked up". Still generated and returned to the owner only.',
  })
  confirmation_code?: string | null;

  @ApiProperty({
    description:
      'True once too many wrong pickup codes were entered. Pickup is refused until the owner issues a new code.',
  })
  pickup_locked: boolean;

  @ApiProperty({
    description:
      'Who tapped "Picked up". While the request is confirmed, the other party has to confirm or decline. Kept after completion as the record of who marked it; null when nobody has, after a decline, or once the request is cancelled.',
    type: String,
    nullable: true,
  })
  pickup_marked_by: string | null;

  @ApiProperty({
    description:
      'When "Picked up" was tapped. Cleared and kept on the same terms as pickup_marked_by.',
    type: String,
    nullable: true,
    example: '2026-06-28T16:28:43.399Z',
  })
  pickup_marked_at: Date | null;

  @ApiProperty({
    description:
      'True when the other party marked the item picked up and the viewer has to confirm or decline. While true the app shows the undismissable confirm sheet.',
  })
  awaiting_pickup_confirmation: boolean;

  @ApiProperty({ description: 'Whether the item has been picked up' })
  is_picked_up: boolean;

  @ApiPropertyOptional({
    description: 'When the item was picked up',
    type: String,
    example: '2026-06-28T16:28:43.399Z',
  })
  picked_up_at?: Date | null;

  @ApiPropertyOptional({
    description: 'When the request was cancelled',
    type: String,
    example: '2026-06-28T16:28:43.399Z',
  })
  cancelled_at?: Date | null;

  @ApiPropertyOptional({ description: 'User ID who cancelled the request' })
  cancelled_by?: string | null;

  @ApiPropertyOptional({ description: 'Reason for cancellation' })
  cancellation_reason?: string | null;

  @ApiProperty({
    description: 'When the request was created',
    type: String,
    example: '2026-06-28T16:28:43.399Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'When the request was last updated',
    type: String,
    example: '2026-06-28T16:28:43.399Z',
  })
  updated_at: Date;

  @ApiPropertyOptional({
    type: () => ItemResponseDto,
    description: 'Item details (only included when relations are loaded)',
  })
  item?: ItemResponseDto;

  @ApiPropertyOptional({
    type: () => ItemUserDto,
    description:
      'Requester user details (only included when relations are loaded)',
  })
  requester?: ItemUserDto;

  @ApiPropertyOptional({
    type: () => ItemUserDto,
    description: 'Owner user details (only included when relations are loaded)',
  })
  owner?: ItemUserDto;
}
