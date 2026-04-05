import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserPreferenceEntity } from '../entities/user-preference.entity';

export class UserPreferenceResponseDto {
  @ApiProperty({ description: 'Preference ID', example: 'uuid' })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'uuid' })
  user_id: string;

  @ApiPropertyOptional({
    description: 'Preferred categories',
    type: 'array',
    items: { type: 'object' },
  })
  preferred_categories?: { id: string; name: string; slug: string; icon_url: string | null }[];

  @ApiPropertyOptional({
    description: 'Notification settings',
    example: { email: true, push: true },
  })
  notification_settings?: Record<string, any> | null;

  @ApiProperty({ description: 'Preferred language', example: 'en' })
  language: string;

  @ApiProperty({ description: 'Preferred theme', example: 'light' })
  theme: string;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updated_at: Date;

  static fromEntity(entity: UserPreferenceEntity): UserPreferenceResponseDto {
    const dto = new UserPreferenceResponseDto();
    dto.id = entity.id;
    dto.user_id = entity.user_id;
    dto.preferred_categories = (entity.preferred_categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon_url: c.icon_url,
    }));
    dto.notification_settings = entity.notification_settings ?? undefined;
    dto.language = entity.language;
    dto.theme = entity.theme;
    dto.created_at = entity.created_at;
    dto.updated_at = entity.updated_at;
    return dto;
  }
}
