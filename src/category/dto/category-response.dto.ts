import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryEntity } from '../entities/category.entity';

export class CategoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiPropertyOptional()
  icon_url?: string | null;

  @ApiPropertyOptional()
  parent_category_id?: string | null;

  @ApiPropertyOptional()
  display_order?: number | null;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  @ApiPropertyOptional({ type: () => [CategoryResponseDto] })
  subcategories?: CategoryResponseDto[];

  @ApiPropertyOptional()
  item_count?: number;

  static fromEntity(
    entity: CategoryEntity,
    includeSubcategories = false,
  ): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.slug = entity.slug;
    dto.icon_url = entity.icon_url;
    dto.parent_category_id = entity.parent_category_id;
    dto.display_order = entity.display_order;
    dto.is_active = entity.is_active;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;

    if (includeSubcategories && entity.subcategories) {
      dto.subcategories = entity.subcategories.map((sub) =>
        CategoryResponseDto.fromEntity(sub, false),
      );
    }

    if (entity.items) {
      dto.item_count = entity.items.length;
    }

    return dto;
  }
}
