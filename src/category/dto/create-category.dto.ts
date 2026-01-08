import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsBoolean,
  IsUrl,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Category name', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'URL-friendly slug (lowercase, hyphens)',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase with hyphens (e.g., "electronics-phones")',
  })
  slug: string;

  @ApiPropertyOptional({ description: 'Icon URL' })
  @IsUrl()
  @IsOptional()
  icon_url?: string;

  @ApiPropertyOptional({ description: 'Parent category ID for subcategories' })
  @IsUUID()
  @IsOptional()
  parent_category_id?: string;

  @ApiPropertyOptional({ description: 'Display order for sorting' })
  @IsInt()
  @IsOptional()
  display_order?: number;

  @ApiPropertyOptional({
    description: 'Whether the category is active',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
