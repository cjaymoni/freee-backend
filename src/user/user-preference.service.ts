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
import { ServiceResponseDto } from '../common/service-response.dto';

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
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
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
    return {
      message: 'User preferences created successfully',
      data: UserPreferenceResponseDto.fromEntity(saved),
      state: true,
      statusCode: 201,
    };
  }

  /**
   * Get user preferences
   */
  async findByUserId(
    userId: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    return {
      message: 'User preferences retrieved successfully',
      data: UserPreferenceResponseDto.fromEntity(preference),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Get or create user preferences
   */
  async getOrCreate(
    userId: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
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

    return {
      message: 'User preferences retrieved successfully',
      data: UserPreferenceResponseDto.fromEntity(preference),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update user preferences
   */
  async update(
    userId: string,
    updateDto: UpdateUserPreferenceDto,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
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
    return {
      message: 'User preferences updated successfully',
      data: UserPreferenceResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Partially update specific preference fields
   */
  async updateCategories(
    userId: string,
    categories: Record<string, any>,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
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
    return {
      message: 'Preferred categories updated successfully',
      data: UserPreferenceResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update notification settings
   */
  async updateNotificationSettings(
    userId: string,
    settings: Record<string, any>,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
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
    return {
      message: 'Notification settings updated successfully',
      data: UserPreferenceResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update language preference
   */
  async updateLanguage(
    userId: string,
    language: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    preference.language = language;
    const updated = await this.preferenceRepository.save(preference);
    return {
      message: 'Language preference updated successfully',
      data: UserPreferenceResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Update theme preference
   */
  async updateTheme(
    userId: string,
    theme: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    const preference = await this.preferenceRepository.findOne({
      where: { user_id: userId },
    });

    if (!preference) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    preference.theme = theme;
    const updated = await this.preferenceRepository.save(preference);
    return {
      message: 'Theme preference updated successfully',
      data: UserPreferenceResponseDto.fromEntity(updated),
      state: true,
      statusCode: 200,
    };
  }

  /**
   * Delete user preferences (hard delete, use with caution)
   */
  async remove(userId: string): Promise<ServiceResponseDto<null>> {
    const result = await this.preferenceRepository.delete({ user_id: userId });

    if (result.affected === 0) {
      throw new NotFoundException(`Preferences not found for user ${userId}`);
    }

    return {
      message: 'User preferences deleted successfully',
      data: null,
      state: true,
      statusCode: 200,
    };
  }
}
