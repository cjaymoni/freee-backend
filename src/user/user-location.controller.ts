import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UserLocationService } from './user-location.service';
import { CreateUserLocationDto } from './dto/create-user-location.dto';
import { UpdateUserLocationDto } from './dto/update-user-location.dto';
import { UserLocationResponseDto } from './dto/user-location-response.dto';
import { GetUser } from '../common/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';
import { ServiceResponseDto } from '../common/service-response.dto';

@ApiTags('User Locations')
@ApiBearerAuth()
@Controller('user/locations')
@UseGuards(JwtAuthGuard)
export class UserLocationController {
  constructor(private readonly locationService: UserLocationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new location for the authenticated user' })
  @ApiResponse({
    status: 201,
    description:
      'Location created successfully. Returns wrapped response with state, data (UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Location created successfully',
            },
            statusCode: { type: 'number', example: 201 },
            data: { $ref: '#/components/schemas/UserLocationResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @GetUser('userId') userId: string,
    @Body() createDto: CreateUserLocationDto,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    return this.locationService.create(userId, createDto);
  }

  @Post('temporary')
  @ApiOperation({
    summary: 'Create a temporary location (not saved to user profile)',
    description:
      'Creates a one-time location that is not associated with the user. Useful for items at non-regular locations.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Temporary location created successfully. Returns wrapped response with state, data (UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Temporary location created successfully',
            },
            statusCode: { type: 'number', example: 201 },
            data: { $ref: '#/components/schemas/UserLocationResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createTemporary(
    @Body() createDto: CreateUserLocationDto,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    return this.locationService.createTemporary(createDto);
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all locations across all users (Admin only)' })
  @ApiResponse({
    status: 200,
    description:
      'All locations retrieved successfully. Returns wrapped response with state, data (array of UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'All locations retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/UserLocationResponseDto' },
            },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Requires admin role' })
  async findAllAdmin(): Promise<ServiceResponseDto<UserLocationResponseDto[]>> {
    return this.locationService.findAllForAdmin();
  }

  @Get()
  @ApiOperation({ summary: 'Get all locations for the authenticated user' })
  @ApiResponse({
    status: 200,
    description:
      'Locations retrieved successfully. Returns wrapped response with state, data (array of UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'User locations retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/UserLocationResponseDto' },
            },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @GetUser('userId') userId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto[]>> {
    return this.locationService.findAllByUserId(userId);
  }

  @Get('primary')
  @ApiOperation({
    summary: 'Get the primary location for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Primary location retrieved successfully',
    type: UserLocationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Primary location not found' })
  async findPrimary(
    @GetUser('userId') userId: string,
  ): Promise<UserLocationResponseDto | null> {
    return this.locationService.findPrimaryLocation(userId);
  }

  @Get('current')
  @ApiOperation({
    summary: 'Get the current location for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Current location retrieved successfully',
    type: UserLocationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Current location not found' })
  async findCurrent(
    @GetUser('userId') userId: string,
  ): Promise<UserLocationResponseDto | null> {
    return this.locationService.findCurrentLocation(userId);
  }

  @Get('country/:countryCode')
  @ApiOperation({
    summary: 'Get all locations by country code for the authenticated user',
  })
  @ApiParam({
    name: 'countryCode',
    description: 'ISO 3166-1 alpha-3 country code',
    example: 'USA',
  })
  @ApiResponse({
    status: 200,
    description:
      'Locations retrieved successfully. Returns wrapped response with state, data (array of UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Locations retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/UserLocationResponseDto' },
            },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findByCountryCode(
    @GetUser('userId') userId: string,
    @Param('countryCode') countryCode: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto[]>> {
    return this.locationService.findByCountryCode(userId, countryCode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific location by ID' })
  @ApiParam({ name: 'id', description: 'Location ID' })
  @ApiResponse({
    status: 200,
    description:
      'Location retrieved successfully. Returns wrapped response with state, data (UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Location retrieved successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserLocationResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async findOne(
    @GetUser('userId') userId: string,
    @Param('id') locationId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    return this.locationService.findOne(userId, locationId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a location' })
  @ApiParam({ name: 'id', description: 'Location ID' })
  @ApiResponse({
    status: 200,
    description:
      'Location updated successfully. Returns wrapped response with state, data (UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Location updated successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserLocationResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async update(
    @GetUser('userId') userId: string,
    @Param('id') locationId: string,
    @Body() updateDto: UpdateUserLocationDto,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    return this.locationService.update(userId, locationId, updateDto);
  }

  @Patch(':id/set-primary')
  @ApiOperation({ summary: 'Set a location as primary' })
  @ApiParam({ name: 'id', description: 'Location ID' })
  @ApiResponse({
    status: 200,
    description:
      'Location set as primary successfully. Returns wrapped response with state, data (UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Location set as primary successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserLocationResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async setPrimary(
    @GetUser('userId') userId: string,
    @Param('id') locationId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    return this.locationService.setPrimary(userId, locationId);
  }

  @Patch(':id/set-current')
  @ApiOperation({ summary: 'Set a location as current' })
  @ApiParam({ name: 'id', description: 'Location ID' })
  @ApiResponse({
    status: 200,
    description:
      'Location set as current successfully. Returns wrapped response with state, data (UserLocationResponseDto), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Location set as current successfully',
            },
            statusCode: { type: 'number', example: 200 },
            data: { $ref: '#/components/schemas/UserLocationResponseDto' },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async setCurrent(
    @GetUser('userId') userId: string,
    @Param('id') locationId: string,
  ): Promise<ServiceResponseDto<UserLocationResponseDto>> {
    return this.locationService.setCurrent(userId, locationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a location (soft delete)' })
  @ApiParam({ name: 'id', description: 'Location ID' })
  @ApiResponse({
    status: 204,
    description:
      'Location deleted successfully. Returns wrapped response with state, data (null), message, and statusCode.',
    schema: {
      allOf: [
        {
          properties: {
            state: { type: 'boolean', example: true },
            message: {
              type: 'string',
              example: 'Location deleted successfully',
            },
            statusCode: { type: 'number', example: 204 },
            data: { type: 'null', example: null },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Cannot delete the only location' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Location not found' })
  async remove(
    @GetUser('userId') userId: string,
    @Param('id') locationId: string,
  ): Promise<ServiceResponseDto<null>> {
    return this.locationService.remove(userId, locationId);
  }
}
