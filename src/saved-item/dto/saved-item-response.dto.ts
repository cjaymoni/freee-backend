import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemResponseDto } from '../../item/dto/item-response.dto';

export class SavedItemResponseDto {
  @ApiProperty({ description: 'Saved item ID' })
  id: string;

  @ApiProperty({ description: 'User ID who saved the item' })
  user_id: string;

  @ApiProperty({ description: 'Item ID that was saved' })
  item_id: string;

  @ApiProperty({
    description: 'Whether this saved item is deleted (soft delete)',
  })
  is_deleted: boolean;

  @ApiPropertyOptional({
    description: 'When the item was unsaved (soft deleted)',
  })
  deleted_at?: Date | null;

  @ApiProperty({ description: 'When the item was saved' })
  created_at: Date;

  @ApiPropertyOptional({
    type: () => ItemResponseDto,
    description: 'Item details (only included when relations are loaded)',
  })
  item?: ItemResponseDto;
}
