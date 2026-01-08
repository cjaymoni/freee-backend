import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemEntity, ItemCondition, ItemStatus } from '../entities/item.entity';
import { UserLocationResponseDto } from '../../user/dto/user-location-response.dto';
import { CategoryResponseDto } from '../../category/dto/category-response.dto';
import { ItemImageResponseDto } from './item-image-response.dto';

export class ItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  category_id?: string;

  @ApiPropertyOptional({ type: () => CategoryResponseDto })
  category?: CategoryResponseDto;

  @ApiProperty({ enum: ItemCondition })
  condition: ItemCondition;

  @ApiProperty({ enum: ItemStatus })
  status: ItemStatus;

  @ApiProperty()
  price: number;

  @ApiProperty()
  is_free: boolean;

  @ApiProperty()
  view_count: number;

  @ApiPropertyOptional()
  location_id?: string;

  @ApiPropertyOptional({ type: () => UserLocationResponseDto })
  location?: UserLocationResponseDto;

  @ApiPropertyOptional()
  pickup_date?: Date | null;

  @ApiProperty()
  is_featured: boolean;

  @ApiPropertyOptional()
  featured_until?: Date | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  @ApiPropertyOptional({ type: () => [ItemImageResponseDto] })
  images?: ItemImageResponseDto[];

  static fromEntity(entity: ItemEntity): ItemResponseDto {
    const dto = new ItemResponseDto();
    dto.id = entity.id;
    dto.user_id = entity.user_id;
    dto.title = entity.title;
    dto.description = entity.description;
    dto.category_id = entity.category_id;
    dto.condition = entity.condition;
    dto.status = entity.status;
    dto.price = Number(entity.price);
    dto.is_free = entity.is_free;
    dto.view_count = entity.view_count;
    dto.location_id = entity.location_id;
    dto.pickup_date = entity.pickup_date;
    dto.is_featured = entity.is_featured;
    dto.featured_until = entity.featured_until;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;

    // Include location details if loaded
    if (entity.location) {
      dto.location = UserLocationResponseDto.fromEntity(entity.location);
    }

    // Include category details if loaded
    if (entity.category) {
      dto.category = CategoryResponseDto.fromEntity(entity.category);
    }

    // Include images if loaded
    if (entity.images) {
      dto.images = entity.images.map((image) =>
        ItemImageResponseDto.fromEntity(image),
      );
    }

    return dto;
  }
}
