import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemImageEntity } from '../entities/item-image.entity';

export class ItemImageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  item_id: string;

  @ApiProperty()
  cloudinary_public_id: string;

  @ApiProperty()
  cloudinary_url: string;

  @ApiProperty()
  cloudinary_secure_url: string;

  @ApiPropertyOptional()
  cloudinary_format?: string | null;

  @ApiPropertyOptional()
  width?: number | null;

  @ApiPropertyOptional()
  height?: number | null;

  @ApiPropertyOptional()
  size_bytes?: number | null;

  @ApiProperty()
  display_order: number;

  @ApiProperty()
  is_primary: boolean;

  @ApiProperty()
  created_at: Date;

  static fromEntity(entity: ItemImageEntity): ItemImageResponseDto {
    const dto = new ItemImageResponseDto();
    dto.id = entity.id;
    dto.item_id = entity.item_id;
    dto.cloudinary_public_id = entity.cloudinary_public_id;
    dto.cloudinary_url = entity.cloudinary_url;
    dto.cloudinary_secure_url = entity.cloudinary_secure_url;
    dto.cloudinary_format = entity.cloudinary_format;
    dto.width = entity.width;
    dto.height = entity.height;
    dto.size_bytes = entity.size_bytes;
    dto.display_order = entity.display_order;
    dto.is_primary = entity.is_primary;
    dto.created_at = entity.created_at;
    return dto;
  }
}
