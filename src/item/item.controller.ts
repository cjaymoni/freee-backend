import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  ParseUUIDPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  itemImageUploadOptions,
  MAX_IMAGES_PER_REQUEST,
} from './item-image-upload.options';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ItemService } from './item.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { ItemStatus } from './entities/item.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/entities/user.entity';
import { UserActivityService } from '../audit/user-activity.service';
import { ServiceResponseDto } from '../common/service-response.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AppError } from '../common/app-error';

const MAX_PAGE_LIMIT = 100;

@ApiTags('Items')
@ApiBearerAuth()
@Controller('items')
export class ItemController {
  constructor(
    private readonly itemService: ItemService,
    private readonly userActivityService: UserActivityService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('images', MAX_IMAGES_PER_REQUEST, itemImageUploadOptions),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'condition'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category_id: { type: 'string', format: 'uuid' },
        condition: { type: 'string', enum: ['new', 'good', 'old'] },
        price: { type: 'number', default: 0 },
        is_free: { type: 'boolean', default: true },
        quantity: { type: 'integer', default: 1, minimum: 1 },
        location_id: { type: 'string', format: 'uuid' },
        latitude: { type: 'number', example: 5.6037 },
        longitude: { type: 'number', example: -0.187 },
        pickup_date: { type: 'string', format: 'date' },
        pickup_time: { type: 'string', example: '14:30' },
        pickup_type: {
          type: 'string',
          enum: ['anytime', 'contact_me', 'specific_date'],
        },
        images: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({ summary: 'Create a new item listing' })
  @ApiResponse({
    status: 201,
    description:
      'Item created successfully. Returns wrapped response with state, data (ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Item created successfully' },
            statusCode: { type: 'number', example: 201 },
            data: { $ref: '#/components/schemas/ItemResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @GetUser('userId') userId: string,
    @Body() createDto: CreateItemDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    return this.itemService.create(userId, createDto, files);
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get all items with optional filters' })
  @ApiQuery({
    name: 'user_id',
    required: false,
    description: 'Filter by user ID',
  })
  @ApiQuery({
    name: 'category_id',
    required: false,
    description: 'Filter by category ID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ItemStatus,
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'is_featured',
    required: false,
    type: Boolean,
    description: 'Filter featured items',
  })
  @ApiQuery({
    name: 'is_free',
    required: false,
    type: Boolean,
    description: 'Filter free items',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    description: 'Requester latitude for proximity filtering',
  })
  @ApiQuery({
    name: 'lng',
    required: false,
    type: Number,
    description: 'Requester longitude for proximity filtering',
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    type: Number,
    description:
      'Radius in km (default: 10). Only applied when lat & lng are provided',
  })
  @ApiQuery({
    name: 'query',
    required: false,
    description:
      'Text search over item titles and descriptions, ignoring case and accents. ' +
      'Can be combined with every other filter. Counts towards GET /search/popular.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description:
      'Page number (default: 1). Sending page or limit paginates the results; ' +
      'otherwise every match is returned. `total` is always included.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `Items per page (1-${MAX_PAGE_LIMIT}, default: 20)`,
  })
  @ApiResponse({
    status: 200,
    description:
      'Items retrieved successfully. Returns wrapped response with state, data (array of ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Items retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/ItemResponseDto' },
            },
          },
        },
      ],
    },
  })
  async findAll(
    @GetUser('userId') viewerId?: string,
    @Query('user_id', new ParseUUIDPipe({ optional: true })) user_id?: string,
    @Query('category_id', new ParseUUIDPipe({ optional: true }))
    category_id?: string,
    @Query('status', new ParseEnumPipe(ItemStatus, { optional: true }))
    status?: ItemStatus,
    @Query('is_featured') is_featured?: boolean,
    @Query('is_free') is_free?: boolean,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radius?: string,
    @Query('query') query?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() request?: Request,
  ): Promise<ServiceResponseDto<ItemResponseDto[]>> {
    const parsedPage = page !== undefined ? Number(page) : undefined;
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    if (
      parsedPage !== undefined &&
      (!Number.isInteger(parsedPage) || parsedPage < 1)
    ) {
      throw new AppError(
        new BadRequestException('page must be a positive integer'),
      );
    }
    if (
      parsedLimit !== undefined &&
      (!Number.isInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > MAX_PAGE_LIMIT)
    ) {
      throw new AppError(
        new BadRequestException(
          `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
        ),
      );
    }

    return this.itemService.findAll({
      user_id,
      category_id,
      status,
      is_featured,
      is_free,
      lat: lat !== undefined ? Number(lat) : undefined,
      lng: lng !== undefined ? Number(lng) : undefined,
      radius: radius !== undefined ? Number(radius) : undefined,
      viewer_id: viewerId,
      query,
      page: parsedPage,
      limit: parsedLimit,
      searcher_key: viewerId || request?.ip,
    });
  }

  @Get('my-items')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all items for the authenticated user' })
  @ApiResponse({
    status: 200,
    description:
      'User items retrieved successfully. Returns wrapped response with state, data (array of ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Items retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/ItemResponseDto' },
            },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findMyItems(
    @GetUser('userId') userId: string,
  ): Promise<ServiceResponseDto<ItemResponseDto[]>> {
    return this.itemService.findAll({ user_id: userId, viewer_id: userId });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get a single item by ID' })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiResponse({
    status: 200,
    description:
      'Item retrieved successfully. Returns wrapped response with state, data (ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Item retrieved successfully' },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('userId') userId: string,
    @Req() request: Request,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const result = await this.itemService.findOne(id, userId, request.ip);

    // Log user activity
    await this.userActivityService.log({
      userId,
      activityType: 'view_item',
      resourceType: 'items',
      resourceId: id,
      ipAddress: request.ip || '',
      deviceType: request.headers['user-agent']?.includes('Mobile')
        ? 'mobile'
        : 'desktop',
      metadata: {
        itemTitle: result.data.title,
        itemCategory: result.data.category_id,
      },
    });

    return result;
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('images', MAX_IMAGES_PER_REQUEST, itemImageUploadOptions),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category_id: { type: 'string', format: 'uuid' },
        condition: {
          type: 'string',
          enum: ['new', 'good', 'old'],
        },
        status: {
          type: 'string',
          enum: ['available', 'reserved', 'picked_up', 'unavailable'],
        },
        price: { type: 'number' },
        is_free: { type: 'boolean' },
        quantity: { type: 'integer', minimum: 1 },
        location_id: { type: 'string', format: 'uuid' },
        latitude: { type: 'number', example: 5.6037 },
        longitude: { type: 'number', example: -0.187 },
        pickup_date: { type: 'string', format: 'date' },
        pickup_time: { type: 'string', example: '14:30' },
        pickup_type: {
          type: 'string',
          enum: ['anytime', 'contact_me', 'specific_date'],
        },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'New images to add. Existing images are kept.',
        },
        remove_image_ids: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description:
            'IDs of existing images to remove. Also accepts a comma-separated string.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Update an item',
    description:
      'Send as multipart/form-data to change images: files in `images` are added to the item, and IDs in `remove_image_ids` are removed. Omitting both leaves the images untouched. An item that has images must keep at least one.',
  })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiResponse({
    status: 200,
    description:
      'Item updated successfully. Returns wrapped response with state, data (ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Item updated successfully' },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() updateDto: UpdateItemDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    return this.itemService.update(userId, id, updateDto, files);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Soft delete an item',
    description:
      'Owners may delete their own items. Admins may remove any item.',
  })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiQuery({
    name: 'reason',
    required: false,
    description: 'Reason for deletion',
  })
  @ApiResponse({
    status: 200,
    description:
      'Item deleted successfully. Returns wrapped response with state, data (ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Item deleted successfully' },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async remove(
    @GetUser('userId') userId: string,
    @GetUser('role') role: UserRole,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    // deletion_reason is varchar(100).
    if (reason && reason.length > 100) {
      throw new BadRequestException('reason must be at most 100 characters');
    }
    if (role === UserRole.ADMIN) {
      return this.itemService.adminRemove(userId, id, reason);
    }
    return this.itemService.remove(userId, id, reason);
  }

  @Post(':id/feature')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Feature an item (Admin only)' })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiQuery({
    name: 'featured_until',
    required: false,
    description: 'Feature until date (ISO 8601)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Item featured successfully. Returns wrapped response with state, data (ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Item featured successfully' },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async feature(
    @Param('id') id: string,
    @Query('featured_until') featured_until?: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    const featuredUntil = featured_until ? new Date(featured_until) : undefined;
    return this.itemService.feature(id, featuredUntil);
  }

  @Delete(':id/feature')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Remove featured status from an item (Admin only)' })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiResponse({
    status: 200,
    description:
      'Item unfeatured successfully. Returns wrapped response with state, data (ItemResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Item unfeatured successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unfeature(
    @Param('id') id: string,
  ): Promise<ServiceResponseDto<ItemResponseDto>> {
    return this.itemService.unfeature(id);
  }
}
