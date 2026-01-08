import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Ip,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { ItemViewService } from './item-view.service';
import { CreateItemViewDto } from './dto/create-item-view.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServiceResponseDto } from '../common/service-response.dto';
import { ItemViewResponseDto } from './dto/item-view-response.dto';

@ApiTags('Item Views')
@ApiExtraModels(ServiceResponseDto, ItemViewResponseDto)
@Controller('item-views')
export class ItemViewController {
  constructor(private readonly itemViewService: ItemViewService) {}

  @Post()
  @ApiOperation({
    summary: 'Record an item view (authenticated or anonymous)',
    description:
      'Records a view event for analytics. Can be called by authenticated users or anonymously.',
  })
  @ApiResponse({
    status: 201,
    description: 'View recorded successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemViewResponseDto) },
            message: { example: 'View recorded successfully' },
            state: { example: true },
            statusCode: { example: 201 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async createView(
    @Body() createItemViewDto: CreateItemViewDto,
    @Ip() ipAddress: string,
    @Request() req,
  ) {
    // Extract user ID if authenticated
    const viewerId = req.user?.userId || null;

    return await this.itemViewService.createView(
      createItemViewDto,
      ipAddress,
      viewerId,
    );
  }

  @Get('stats/:itemId')
  @ApiOperation({ summary: 'Get view statistics for an item' })
  @ApiParam({ name: 'itemId', description: 'ID of the item' })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    example: 30,
    description: 'Number of days to include in stats (default: 30)',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'object',
              properties: {
                total_views: { type: 'number', example: 150 },
                unique_viewers: { type: 'number', example: 75 },
                authenticated_views: { type: 'number', example: 50 },
                anonymous_views: { type: 'number', example: 100 },
                device_breakdown: {
                  type: 'object',
                  example: { mobile: 80, desktop: 60, tablet: 10 },
                },
                daily_views: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string', example: '2026-01-08' },
                      views: { type: 'number', example: 15 },
                    },
                  },
                },
              },
            },
            message: { example: 'Item view statistics retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async getItemViewStats(
    @Param('itemId') itemId: string,
    @Query('days') days: number = 30,
  ) {
    return await this.itemViewService.getItemViewStats(itemId, Number(days));
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get viewing history for authenticated user' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'View history retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ItemViewResponseDto) },
            },
            total: { type: 'number', example: 25 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 20 },
            message: { example: 'View history retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async getUserViewHistory(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    const userId = req.user.userId;
    return await this.itemViewService.getUserViewHistory(
      userId,
      Number(page),
      Number(limit),
    );
  }
}
