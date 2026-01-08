import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateItemImageDto {
  @ApiProperty({ description: 'Cloudinary public ID' })
  @IsString()
  @IsNotEmpty()
  cloudinary_public_id: string;

  @ApiProperty({ description: 'Cloudinary URL' })
  @IsUrl()
  @IsNotEmpty()
  cloudinary_url: string;

  @ApiProperty({ description: 'Cloudinary secure URL' })
  @IsUrl()
  @IsNotEmpty()
  cloudinary_secure_url: string;

  @ApiPropertyOptional({ description: 'Image format (e.g., jpg, png)' })
  @IsString()
  @IsOptional()
  cloudinary_format?: string;

  @ApiPropertyOptional({ description: 'Image width in pixels' })
  @IsInt()
  @IsOptional()
  @Min(0)
  width?: number;

  @ApiPropertyOptional({ description: 'Image height in pixels' })
  @IsInt()
  @IsOptional()
  @Min(0)
  height?: number;

  @ApiPropertyOptional({ description: 'File size in bytes' })
  @IsInt()
  @IsOptional()
  @Min(0)
  size_bytes?: number;

  @ApiPropertyOptional({ description: 'Display order', default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({
    description: 'Whether this is the primary image',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}
