import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemResponseDto } from '../../item/dto/item-response.dto';

export class ItemViewResponseDto {
  @ApiProperty({ description: 'View record ID' })
  id: string;

  @ApiProperty({ description: 'Item ID that was viewed' })
  item_id: string;

  @ApiPropertyOptional({
    description: 'User ID who viewed the item (null for anonymous views)',
  })
  viewer_id?: string | null;

  @ApiProperty({ description: 'IP address of the viewer' })
  ip_address: string;

  @ApiPropertyOptional({ description: 'Device type used for viewing' })
  device_type?: string | null;

  @ApiPropertyOptional({ description: 'Referrer URL' })
  referrer?: string | null;

  @ApiPropertyOptional({
    description: 'How long the user viewed the item (in seconds)',
  })
  view_duration_seconds?: number | null;

  @ApiProperty({ description: 'When the view occurred' })
  created_at: Date;

  @ApiPropertyOptional({
    type: () => ItemResponseDto,
    description: 'Item details (only included when relations are loaded)',
  })
  item?: ItemResponseDto;
}
