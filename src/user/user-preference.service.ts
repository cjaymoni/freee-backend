import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { CreateUserPreferenceDto } from './dto/create-user-preference.dto';
import { UpdateUserPreferenceDto } from './dto/update-user-preference.dto';
import { UserPreferenceResponseDto } from './dto/user-preference-response.dto';

@Injectable()
export class UserPreferenceService {
  constructor(
    @InjectRepository(UserPreferenceEntity)
    private readonly preferenceRepository: Repository<UserPreferenceEntity>,
  ) {}

  /**
   * Create user preferences (should be called once per user)
   */
  async create(
    userId: string,
    createDto: CreateUserPreferenceDto,
  ): Promise<UserPreferenceResponseDto> {
    // Check if preferences already exist
    const existing = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (existing) {
      throw new ConflictException(
        'User preferences already exist. Use update instead.',
      );
    }

    const preference = new UserPreferenceEntity();
    preference.user_id = userId;
    preference.preferred_categories = createDto.preferred_categories || null;
    preference.notification_settings = createDto.notification_settings || null;
    preference.language = createDto.language || 'en';
    preference.theme = createDto.theme || 'light';

    const saved = await this.preferenceRepository.save(preference);
    return UserPreferenceResponseDto.fromEntity(saved);
  }

  /**
   * Get user preferences
   */
  async findByUserId(userId: string): Promise<UserPreferenceResponseDto> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    return UserPreferenceResponseDto.fromEntity(preference);
  }

  /**
   * Get or create user preferences
   */
  async getOrCreate(userId: string): Promise<UserPreferenceResponseDto> {
    let preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      preference = new UserPreferenceEntity();
      preference.user_id = userId;
      preference.language = 'en';
      preference.theme = 'light';
      preference = await this.preferenceRepository.save(preference);
    }

    return UserPreferenceResponseDto.fromEntity(preference);
  }

  /**
   * Update user preferences
   */
  async update(
    userId: string,
    updateDto: UpdateUserPreferenceDto,
  ): Promise<UserPreferenceResponseDto> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    // Merge updates
    if (updateDto.preferred_categories !== undefined) {
      preference.preferred_categories = updateDto.preferred_categories;
    }
    if (updateDto.notification_settings !== undefined) {
      preference.notification_settings = updateDto.notification_settings;
    }
    if (updateDto.language !== undefined) {
      preference.language = updateDto.language;
    }
    if (updateDto.theme !== undefined) {
      preference.theme = updateDto.theme;
    }

    const updated = await this.preferenceRepository.save(preference);
    return UserPreferenceResponseDto.fromEntity(updated);
  }

  /**
   * Partially update specific preference fields
   */
  async updateCategories(
    userId: string,
    categories: Record<string, any>,
  ): Promise<UserPreferenceResponseDto> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    // Merge with existing categories
    preference.preferred_categories = {
      ...(preference.preferred_categories || {}),
      ...categories,
    };

    const updated = await this.preferenceRepository.save(preference);
    return UserPreferenceResponseDto.fromEntity(updated);
  }

  /**
   * Update notification settings
   */
  async updateNotificationSettings(
    userId: string,
    settings: Record<string, any>,
  ): Promise<UserPreferenceResponseDto> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    // Merge with existing notification settings
    preference.notification_settings = {
      ...(preference.notification_settings || {}),
      ...settings,
    };

    const updated = await this.preferenceRepository.save(preference);
    return UserPreferenceResponseDto.fromEntity(updated);
  }

  /**
   * Update language preference
   */
  async updateLanguage(
    userId: string,
    language: string,
  ): Promise<UserPreferenceResponseDto> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    preference.language = language;
    const updated = await this.preferenceRepository.save(preference);
    return UserPreferenceResponseDto.fromEntity(updated);
  }

  /**
   * Update theme preference
   */
  async updateTheme(
    userId: string,
    theme: string,
  ): Promise<UserPreferenceResponseDto> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    preference.theme = theme;
    const updated = await this.preferenceRepository.save(preference);
    return UserPreferenceResponseDto.fromEntity(updated);
  }

  /**
   * Delete user preferences (hard delete, use with caution)
   */
  async remove(userId: string): Promise<void> {
    const result = await this.preferenceRepository.delete({ user_id: userId });

    if (result.affected === 0) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }
  }
}
