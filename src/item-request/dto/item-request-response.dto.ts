import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RequestStatus } from '../entities/item-request.entity';
import { ItemResponseDto } from '../../item/dto/item-response.dto';
import { UserResponseDto } from '../../user/dto/user-response.dto';

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
    enum: RequestStatus,
    description: 'Current status of the request',
  })
  status: RequestStatus;

  @ApiPropertyOptional({ description: 'Scheduled pickup date' })
  pickup_date?: Date | null;

  @ApiPropertyOptional({ description: 'Scheduled pickup time' })
  pickup_time?: string | null;

  @ApiPropertyOptional({
    description:
      'Confirmation code for pickup (only visible to requester and owner)',
  })
  confirmation_code?: string | null;

  @ApiProperty({ description: 'Whether the item has been picked up' })
  is_picked_up: boolean;

  @ApiPropertyOptional({ description: 'When the item was picked up' })
  picked_up_at?: Date | null;

  @ApiPropertyOptional({ description: 'When the request was cancelled' })
  cancelled_at?: Date | null;

  @ApiPropertyOptional({ description: 'User ID who cancelled the request' })
  cancelled_by?: string | null;

  @ApiPropertyOptional({ description: 'Reason for cancellation' })
  cancellation_reason?: string | null;

  @ApiProperty({ description: 'When the request was created' })
  created_at: Date;

  @ApiProperty({ description: 'When the request was last updated' })
  updated_at: Date;

  @ApiPropertyOptional({
    type: () => ItemResponseDto,
    description: 'Item details (only included when relations are loaded)',
  })
  item?: ItemResponseDto;

  @ApiPropertyOptional({
    type: () => UserResponseDto,
    description:
      'Requester user details (only included when relations are loaded)',
  })
  requester?: UserResponseDto;

  @ApiPropertyOptional({
    type: () => UserResponseDto,
    description: 'Owner user details (only included when relations are loaded)',
  })
  owner?: UserResponseDto;
}
