import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemEntity, ItemCondition, ItemStatus, PickupType } from '../entities/item.entity';
import { UserLocationResponseDto } from '../../user/dto/user-location-response.dto';
import { CategoryResponseDto } from '../../category/dto/category-response.dto';
import { ItemImageResponseDto } from './item-image-response.dto';
import { ItemUserDto } from './item-user.dto';

export class ItemResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  user_id: string;

  @ApiProperty({ example: 'Barely used bicycle' })
  title: string;

  @ApiPropertyOptional({ example: 'Good condition, used for 6 months' })
  description?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  category_id?: string;

  @ApiPropertyOptional({ type: () => CategoryResponseDto })
  category?: CategoryResponseDto;

  @ApiProperty({ enum: ItemCondition, enumName: 'ItemCondition', description: 'Item condition. Note: items with condition "used" cannot be requested.' })
  condition: ItemCondition;

  @ApiProperty({ enum: ItemStatus, enumName: 'ItemStatus' })
  status: ItemStatus;

  @ApiProperty({ example: 0 })
  price: number;

  @ApiProperty({ example: true })
  is_free: boolean;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 42 })
  view_count: number;

  @ApiProperty({ example: ['uuid-1', 'uuid-2'], type: [String] })
  requester_ids: string[];

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  location_id?: string;

  @ApiPropertyOptional({ type: () => UserLocationResponseDto })
  location?: UserLocationResponseDto;

  @ApiPropertyOptional({
    description: 'Scheduled pickup datetime (ISO 8601)',
    type: String,
    example: '2026-06-28T16:28:43.399Z',
  })
  pickup_date?: Date | null;

  @ApiPropertyOptional({ example: '14:30' })
  pickup_time?: string | null;

  @ApiPropertyOptional({ enum: PickupType, enumName: 'PickupType' })
  pickup_type?: PickupType | null;

  @ApiProperty({ example: false })
  is_featured: boolean;

  @ApiPropertyOptional({
    description: 'When the featured period expires',
    type: String,
    example: '2026-12-31T23:59:59.000Z',
  })
  featured_until?: Date | null;

  @ApiProperty({ type: String, example: '2026-06-28T16:28:43.399Z' })
  created_at: Date;

  @ApiProperty({ type: String, example: '2026-06-28T16:28:43.399Z' })
  updated_at: Date;

  @ApiPropertyOptional({ type: () => [ItemImageResponseDto] })
  images?: ItemImageResponseDto[];

  @ApiPropertyOptional({ type: () => ItemUserDto })
  user?: ItemUserDto;

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
    dto.quantity = entity.quantity;
    dto.view_count = entity.view_count;
    dto.requester_ids = entity.requester_ids ?? [];
    dto.location_id = entity.location_id;
    dto.pickup_date = entity.pickup_date;
    dto.pickup_time = entity.pickup_time;
    dto.pickup_type = entity.pickup_type;
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

    // Include user details if loaded
    if (entity.user) {
      const u = entity.user;
      dto.user = {
        id: u.id,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || '',
        profile_image: u.cloudinary_avatar_url ?? null,
        joined_date: u.member_since,
        phone_number: u.phone_number ?? null,
        items_count: (u as any).items_count ?? 0,
      };
    }

    return dto;
  }
}
