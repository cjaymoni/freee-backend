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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/entities/user.entity';
import { ServiceResponseDto } from '../common/service-response.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new category (Admin only)' })
  @ApiResponse({
    status: 201,
    description:
      'Category created successfully. Returns wrapped response with state, data (CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Category created successfully',
            },
            statusCode: { type: 'number', example: 201 },
            data: { $ref: '#/components/schemas/CategoryResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 409, description: 'Category slug already exists' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async create(
    @Body() createDto: CreateCategoryDto,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    return this.categoryService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all categories with optional filters' })
  @ApiQuery({
    name: 'active_only',
    required: false,
    type: Boolean,
    description: 'Filter only active categories',
  })
  @ApiQuery({
    name: 'include_subcategories',
    required: false,
    type: Boolean,
    description: 'Include subcategories in response',
  })
  @ApiResponse({
    status: 200,
    description:
      'Categories retrieved successfully. Returns wrapped response with state, data (array of CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Categories retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/CategoryResponseDto' },
            },
          },
        },
      ],
    },
  })
  async findAll(
    @Query('active_only') activeOnly?: boolean,
    @Query('include_subcategories') includeSubcategories?: boolean,
  ): Promise<ServiceResponseDto<CategoryResponseDto[]>> {
    const onlyActive = activeOnly !== false; // default true
    const includeSubs = includeSubcategories !== false; // default true
    return this.categoryService.findAll(onlyActive, includeSubs);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get a category by slug' })
  @ApiParam({ name: 'slug', description: 'Category slug' })
  @ApiResponse({
    status: 200,
    description:
      'Category retrieved successfully. Returns wrapped response with state, data (CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Category retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/CategoryResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findBySlug(
    @Param('slug') slug: string,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    return this.categoryService.findBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description:
      'Category retrieved successfully. Returns wrapped response with state, data (CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Category retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/CategoryResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOne(
    @Param('id') id: string,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    return this.categoryService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a category (Admin only)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description:
      'Category updated successfully. Returns wrapped response with state, data (CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Category updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/CategoryResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateCategoryDto,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    return this.categoryService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft delete a category (Admin only)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description:
      'Category deleted successfully. Returns wrapped response with state, data (CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Category deleted successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/CategoryResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async remove(
    @Param('id') id: string,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    return this.categoryService.remove(id);
  }

  @Post(':id/toggle-active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle category active status (Admin only)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description:
      'Category status toggled successfully. Returns wrapped response with state, data (CategoryResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Category status toggled successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/CategoryResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async toggleActive(
    @Param('id') id: string,
  ): Promise<ServiceResponseDto<CategoryResponseDto>> {
    return this.categoryService.toggleActive(id);
  }
}
