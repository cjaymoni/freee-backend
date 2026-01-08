import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserLocationDto {
  @ApiProperty({
    description: 'ISO 3166-1 alpha-3 country code',
    example: 'USA',
    maxLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  country_code: string;

  @ApiProperty({
    description: 'Country name',
    example: 'United States',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country_name: string;

  @ApiPropertyOptional({
    description: 'Region or state',
    example: 'California',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({
    description: 'City',
    example: 'San Francisco',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    description: 'Area or neighborhood',
    example: 'Downtown',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  area?: string;

  @ApiPropertyOptional({
    description: 'Full address text',
    example: '123 Main Street, Apt 4B',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'Location label for easy identification',
    example: 'Home',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    description: 'Latitude coordinate',
    example: 37.7749,
    minimum: -90,
    maximum: 90,
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Longitude coordinate',
    example: -122.4194,
    minimum: -180,
    maximum: 180,
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Whether this is the current location',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_current?: boolean;

  @ApiPropertyOptional({
    description: 'Whether this is the primary location',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}
