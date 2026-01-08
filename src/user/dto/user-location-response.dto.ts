import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationEntity } from '../entities/location.entity';

export class UserLocationResponseDto {
  @ApiProperty({ description: 'Location ID', example: 'uuid' })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'uuid', nullable: true })
  user_id: string | null;

  @ApiProperty({
    description: 'ISO 3166-1 alpha-3 country code',
    example: 'USA',
  })
  country_code: string;

  @ApiProperty({ description: 'Country name', example: 'United States' })
  country_name: string;

  @ApiPropertyOptional({
    description: 'Region or state',
    example: 'California',
  })
  region?: string;

  @ApiPropertyOptional({ description: 'City', example: 'San Francisco' })
  city?: string;

  @ApiPropertyOptional({
    description: 'Area or neighborhood',
    example: 'Downtown',
  })
  area?: string;

  @ApiPropertyOptional({
    description: 'Full address text',
    example: '123 Main Street, Apt 4B',
  })
  address?: string;

  @ApiPropertyOptional({
    description: 'Location label',
    example: 'Home',
  })
  label?: string;

  @ApiPropertyOptional({ description: 'Latitude coordinate', example: 37.7749 })
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Longitude coordinate',
    example: -122.4194,
  })
  longitude?: number;

  @ApiProperty({ description: 'Whether this is the current location' })
  is_current: boolean;

  @ApiProperty({ description: 'Whether this is the primary location' })
  is_primary: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updated_at: Date;

  static fromEntity(entity: LocationEntity): UserLocationResponseDto {
    const dto = new UserLocationResponseDto();
    dto.id = entity.id;
    dto.user_id = entity.user_id;
    dto.country_code = entity.country_code;
    dto.country_name = entity.country_name;
    dto.region = entity.region;
    dto.city = entity.city;
    dto.area = entity.area;
    dto.address = entity.address;
    dto.label = entity.label;
    dto.latitude = entity.latitude ? Number(entity.latitude) : undefined;
    dto.longitude = entity.longitude ? Number(entity.longitude) : undefined;
    dto.is_current = entity.is_current;
    dto.is_primary = entity.is_primary;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    return dto;
  }
}
