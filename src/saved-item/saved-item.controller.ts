import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
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
import { SavedItemService } from './saved-item.service';
import { CreateSavedItemDto } from './dto/create-saved-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ServiceResponseDto } from '../common/service-response.dto';
import { SavedItemResponseDto } from './dto/saved-item-response.dto';

@ApiTags('Saved Items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiExtraModels(ServiceResponseDto, SavedItemResponseDto)
@Controller('saved-items')
export class SavedItemController {
  constructor(private readonly savedItemService: SavedItemService) {}

  @Post()
  @ApiOperation({ summary: 'Save an item to user favorites' })
  @ApiResponse({
    status: 201,
    description: 'Item saved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(SavedItemResponseDto) },
            message: { example: 'Item saved successfully' },
            state: { example: true },
            statusCode: { example: 201 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 409, description: 'Item already saved' })
  async saveItem(
    @Request() req,
    @Body() createSavedItemDto: CreateSavedItemDto,
  ) {
    const userId = req.user.userId;
    return await this.savedItemService.saveItem(userId, createSavedItemDto);
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove an item from user favorites' })
  @ApiParam({ name: 'itemId', description: 'ID of the item to unsave' })
  @ApiResponse({
    status: 200,
    description: 'Item unsaved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(SavedItemResponseDto) },
            message: { example: 'Item unsaved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Saved item not found' })
  async unsaveItem(@Request() req, @Param('itemId') itemId: string) {
    const userId = req.user.userId;
    return await this.savedItemService.unsaveItem(userId, itemId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all saved items for the authenticated user' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Saved items retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(SavedItemResponseDto) },
            },
            total: { type: 'number', example: 10 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 20 },
            message: { example: 'Saved items retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async getUserSavedItems(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    const userId = req.user.userId;
    return await this.savedItemService.getUserSavedItems(
      userId,
      Number(page),
      Number(limit),
    );
  }

  @Get('check/:itemId')
  @ApiOperation({ summary: 'Check if an item is saved by the user' })
  @ApiParam({ name: 'itemId', description: 'ID of the item to check' })
  @ApiResponse({
    status: 200,
    description: 'Check completed',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'object',
              properties: {
                is_saved: { type: 'boolean', example: true },
              },
            },
            message: { example: 'Check completed successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async checkIfSaved(@Request() req, @Param('itemId') itemId: string) {
    const userId = req.user.userId;
    return await this.savedItemService.checkIfSaved(userId, itemId);
  }
}
