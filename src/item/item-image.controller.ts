import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { ItemImageService } from './item-image.service';
import { CreateItemImageDto } from './dto/create-item-image.dto';
import { ItemImageResponseDto } from './dto/item-image-response.dto';
import { GetUser } from '../common/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServiceResponseDto } from '../common/service-response.dto';

@ApiTags('Item Images')
@ApiBearerAuth()
@Controller('items/:itemId/images')
@UseGuards(JwtAuthGuard)
export class ItemImageController {
  constructor(private readonly imageService: ItemImageService) {}

  @Post()
  @ApiOperation({ summary: 'Add an image to an item' })
  @ApiParam({ name: 'itemId', description: 'Item ID' })
  @ApiResponse({
    status: 201,
    description:
      'Image added successfully. Returns wrapped response with state, data (ItemImageResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Image added successfully' },
            statusCode: { type: 'number', example: 201 },
            data: { $ref: '#/components/schemas/ItemImageResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @GetUser('userId') userId: string,
    @Param('itemId') itemId: string,
    @Body() createDto: CreateItemImageDto,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    return this.imageService.create(userId, itemId, createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all images for an item' })
  @ApiParam({ name: 'itemId', description: 'Item ID' })
  @ApiResponse({
    status: 200,
    description:
      'Images retrieved successfully. Returns wrapped response with state, data (array of ItemImageResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Images retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/ItemImageResponseDto' },
            },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Param('itemId') itemId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto[]>> {
    return this.imageService.findAllByItemId(itemId);
  }

  @Get(':imageId')
  @ApiOperation({ summary: 'Get a single image by ID' })
  @ApiParam({ name: 'itemId', description: 'Item ID' })
  @ApiParam({ name: 'imageId', description: 'Image ID' })
  @ApiResponse({
    status: 200,
    description:
      'Image retrieved successfully. Returns wrapped response with state, data (ItemImageResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Image retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemImageResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(
    @Param('imageId') imageId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    return this.imageService.findOne(imageId);
  }

  @Patch(':imageId/set-primary')
  @ApiOperation({ summary: 'Set an image as the primary image' })
  @ApiParam({ name: 'itemId', description: 'Item ID' })
  @ApiParam({ name: 'imageId', description: 'Image ID' })
  @ApiResponse({
    status: 200,
    description:
      'Primary image set successfully. Returns wrapped response with state, data (ItemImageResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Image set as primary successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemImageResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async setPrimary(
    @GetUser('userId') userId: string,
    @Param('imageId') imageId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    return this.imageService.setPrimary(userId, imageId);
  }

  @Patch(':imageId/display-order')
  @ApiOperation({ summary: 'Update image display order' })
  @ApiParam({ name: 'itemId', description: 'Item ID' })
  @ApiParam({ name: 'imageId', description: 'Image ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        display_order: { type: 'number', minimum: 0 },
      },
      required: ['display_order'],
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Display order updated successfully. Returns wrapped response with state, data (ItemImageResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Display order updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemImageResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateDisplayOrder(
    @GetUser('userId') userId: string,
    @Param('imageId') imageId: string,
    @Body('display_order') displayOrder: number,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    return this.imageService.updateDisplayOrder(userId, imageId, displayOrder);
  }

  @Delete(':imageId')
  @ApiOperation({ summary: 'Delete an image from an item' })
  @ApiParam({ name: 'itemId', description: 'Item ID' })
  @ApiParam({ name: 'imageId', description: 'Image ID' })
  @ApiResponse({
    status: 200,
    description:
      'Image deleted successfully. Returns wrapped response with state, data (ItemImageResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Image deleted successfully' },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/ItemImageResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Image not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 400, description: 'Cannot delete last image' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async remove(
    @GetUser('userId') userId: string,
    @Param('imageId') imageId: string,
  ): Promise<ServiceResponseDto<ItemImageResponseDto>> {
    return this.imageService.remove(userId, imageId);
  }
}
