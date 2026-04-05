import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { UserPreferenceService } from './user-preference.service';
import { CreateUserPreferenceDto } from './dto/create-user-preference.dto';
import { UpdateUserPreferenceDto } from './dto/update-user-preference.dto';
import { UserPreferenceResponseDto } from './dto/user-preference-response.dto';
import { GetUser } from '../common/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServiceResponseDto } from '../common/service-response.dto';

@ApiTags('User Preferences')
@ApiBearerAuth()
@Controller('user/preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferenceController {
  constructor(private readonly preferenceService: UserPreferenceService) {}

  @Post()
  @ApiOperation({
    summary: 'Create preferences for the authenticated user',
    description:
      'Creates user preferences. Should only be called once per user.',
  })
  @ApiResponse({
    status: 201,
    description: 'Preferences created successfully',
    type: UserPreferenceResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 409,
    description: 'Preferences already exist',
  })
  async create(
    @GetUser('userId') userId: string,
    @Body() createDto: CreateUserPreferenceDto,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.create(userId, createDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get preferences for the authenticated user',
    description: 'Retrieves the user preferences or returns 404 if not found.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Preferences retrieved successfully. Returns wrapped response with state, data (UserPreferenceResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'User preferences retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserPreferenceResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Preferences not found',
  })
  async findOne(
    @GetUser('userId') userId: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.findByUserId(userId);
  }

  @Get('or-create')
  @ApiOperation({
    summary: 'Get or create preferences for the authenticated user',
    description:
      'Retrieves existing preferences or creates default preferences if none exist.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Preferences retrieved or created successfully. Returns wrapped response with state, data (UserPreferenceResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'User preferences retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserPreferenceResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getOrCreate(
    @GetUser('userId') userId: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.getOrCreate(userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Update preferences for the authenticated user',
    description: 'Updates user preferences. All fields are optional.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Preferences updated successfully. Returns wrapped response with state, data (UserPreferenceResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'User preferences updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserPreferenceResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Preferences not found',
  })
  async update(
    @GetUser('userId') userId: string,
    @Body() updateDto: UpdateUserPreferenceDto,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.update(userId, updateDto);
  }

  @Patch('categories')
  @ApiOperation({
    summary: 'Set preferred categories (screen 8 of onboarding)',
    description: 'Replaces the user\'s preferred categories with the provided list of category IDs.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['category_ids'],
      properties: {
        category_ids: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          example: ['uuid1', 'uuid2', 'uuid3'],
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Categories updated successfully', type: UserPreferenceResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Preferences not found' })
  async setCategories(
    @GetUser('userId') userId: string,
    @Body('category_ids') categoryIds: string[],
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.setPreferredCategories(userId, categoryIds);
  }

  @Patch('notifications')
  @ApiOperation({
    summary: 'Update notification settings',
    description:
      'Merges the provided notification settings with existing ones. Use this to update specific notification preferences.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      example: { email: true, push: false, sms: true },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Notification settings updated successfully. Returns wrapped response with state, data (UserPreferenceResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Notification settings updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserPreferenceResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Preferences not found',
  })
  async updateNotificationSettings(
    @GetUser('userId') userId: string,
    @Body() settings: Record<string, any>,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.updateNotificationSettings(userId, settings);
  }

  @Patch('language')
  @ApiOperation({
    summary: 'Update language preference',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          example: 'fr',
          description: 'ISO 639-1 language code',
        },
      },
      required: ['language'],
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Language updated successfully. Returns wrapped response with state, data (UserPreferenceResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Language preference updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserPreferenceResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Preferences not found',
  })
  async updateLanguage(
    @GetUser('userId') userId: string,
    @Body('language') language: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.updateLanguage(userId, language);
  }

  @Patch('theme')
  @ApiOperation({
    summary: 'Update theme preference',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        theme: {
          type: 'string',
          example: 'dark',
          enum: ['light', 'dark', 'auto'],
        },
      },
      required: ['theme'],
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Theme updated successfully. Returns wrapped response with state, data (UserPreferenceResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Theme preference updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserPreferenceResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Preferences not found',
  })
  async updateTheme(
    @GetUser('userId') userId: string,
    @Body('theme') theme: string,
  ): Promise<ServiceResponseDto<UserPreferenceResponseDto>> {
    return this.preferenceService.updateTheme(userId, theme);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete preferences for the authenticated user',
    description:
      'Permanently deletes user preferences. Use with caution as this is a hard delete.',
  })
  @ApiResponse({
    status: 204,
    description:
      'Preferences deleted successfully. Returns wrapped response with state, data (null), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'User preferences deleted successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { type: 'null', example: null },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Preferences not found',
  })
  async remove(
    @GetUser('userId') userId: string,
  ): Promise<ServiceResponseDto<null>> {
    return this.preferenceService.remove(userId);
  }
}
