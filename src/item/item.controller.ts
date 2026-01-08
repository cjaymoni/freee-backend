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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
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

@ApiTags('Items')
@ApiBearerAuth()
@Controller('items')
@UseGuards(JwtAuthGuard)
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new item listing' })
  @ApiResponse({
    status: 201,
    description: 'Item created successfully',
    type: ItemResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @GetUser('userId') userId: string,
    @Body() createDto: CreateItemDto,
  ): Promise<ItemResponseDto> {
    return this.itemService.create(userId, createDto);
  }

  @Get()
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
  @ApiResponse({
    status: 200,
    description: 'Items retrieved successfully',
    type: [ItemResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Query('user_id') user_id?: string,
    @Query('category_id') category_id?: string,
    @Query('status') status?: ItemStatus,
    @Query('is_featured') is_featured?: boolean,
    @Query('is_free') is_free?: boolean,
  ): Promise<ItemResponseDto[]> {
    return this.itemService.findAll({
      user_id,
      category_id,
      status,
      is_featured,
      is_free,
    });
  }

  @Get('my-items')
  @ApiOperation({ summary: 'Get all items for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'User items retrieved successfully',
    type: [ItemResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findMyItems(
    @GetUser('userId') userId: string,
  ): Promise<ItemResponseDto[]> {
    return this.itemService.findAll({ user_id: userId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single item by ID' })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiResponse({
    status: 200,
    description: 'Item retrieved successfully',
    type: ItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(@Param('id') id: string): Promise<ItemResponseDto> {
    return this.itemService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an item' })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiResponse({
    status: 200,
    description: 'Item updated successfully',
    type: ItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async update(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Body() updateDto: UpdateItemDto,
  ): Promise<ItemResponseDto> {
    return this.itemService.update(userId, id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete an item' })
  @ApiParam({ name: 'id', description: 'Item ID' })
  @ApiQuery({
    name: 'reason',
    required: false,
    description: 'Reason for deletion',
  })
  @ApiResponse({
    status: 200,
    description: 'Item deleted successfully',
    type: ItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - not item owner' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async remove(
    @GetUser('userId') userId: string,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ): Promise<ItemResponseDto> {
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
    description: 'Item featured successfully',
    type: ItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async feature(
    @Param('id') id: string,
    @Query('featured_until') featured_until?: string,
  ): Promise<ItemResponseDto> {
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
    description: 'Item unfeatured successfully',
    type: ItemResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unfeature(@Param('id') id: string): Promise<ItemResponseDto> {
    return this.itemService.unfeature(id);
  }
}
