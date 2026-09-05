import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
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
import { ItemRequestService } from './item-request.service';
import { CreateItemRequestDto } from './dto/create-item-request.dto';
import { UpdateItemRequestDto } from './dto/update-item-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import { ConfirmPickupDto } from './dto/confirm-pickup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestStatus } from './entities/item-request.entity';
import { ServiceResponseDto } from '../common/service-response.dto';
import { ItemRequestResponseDto } from './dto/item-request-response.dto';

@ApiTags('Item Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiExtraModels(ServiceResponseDto, ItemRequestResponseDto)
@Controller('item-requests')
export class ItemRequestController {
  constructor(private readonly itemRequestService: ItemRequestService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new item request' })
  @ApiResponse({
    status: 201,
    description: 'Request created successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: { example: 'Request created successfully' },
            state: { example: true },
            statusCode: { example: 201 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 409, description: 'Already have a pending request' })
  async createRequest(
    @Request() req,
    @Body() createItemRequestDto: CreateItemRequestDto,
  ) {
    const requesterId = req.user.userId;
    return this.itemRequestService.createRequest(
      requesterId,
      createItemRequestDto,
    );
  }

  @Patch(':requestId/confirm')
  @ApiOperation({
    summary: 'Confirm a request (owner only)',
    description: 'Item owner confirms the request and sets pickup details',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Request confirmed successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: { example: 'Request confirmed successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async confirmRequest(
    @Request() req,
    @Param('requestId') requestId: string,
    @Body() updateDto: UpdateItemRequestDto,
  ) {
    const ownerId = req.user.userId;
    return this.itemRequestService.confirmRequest(
      ownerId,
      requestId,
      updateDto,
    );
  }

  @Patch(':requestId/cancel')
  @ApiOperation({
    summary: 'Cancel a request',
    description: 'Either requester or owner can cancel the request',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Request cancelled successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: { example: 'Request cancelled successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async cancelRequest(
    @Request() req,
    @Param('requestId') requestId: string,
    @Body() cancelDto: CancelRequestDto,
  ) {
    const userId = req.user.userId;
    return this.itemRequestService.cancelRequest(userId, requestId, cancelDto);
  }

  @Patch(':requestId/pickup')
  @ApiOperation({
    summary: 'Confirm pickup with confirmation code',
    description:
      'Requester confirms item pickup using the code provided by owner',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Pickup confirmed successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: { example: 'Pickup confirmed successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid confirmation code' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async confirmPickup(
    @Request() req,
    @Param('requestId') requestId: string,
    @Body() confirmPickupDto: ConfirmPickupDto,
  ) {
    const requesterId = req.user.userId;
    return this.itemRequestService.confirmPickup(
      requesterId,
      requestId,
      confirmPickupDto.confirmation_code,
    );
  }

  @Get('my-requests')
  @ApiOperation({ summary: 'Get all requests made by the authenticated user' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: RequestStatus,
    description: 'Filter by request status',
  })
  @ApiResponse({
    status: 200,
    description: 'Requests retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ItemRequestResponseDto) },
            },
            total: { type: 'number', example: 15 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 20 },
            message: { example: 'User requests retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async getUserRequests(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('status') status?: RequestStatus,
  ) {
    const userId = req.user.userId;
    return this.itemRequestService.getUserRequests(
      userId,
      Number(page),
      Number(limit),
      status,
    );
  }

  @Get('received')
  @ApiOperation({ summary: 'Get all requests received for your items' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: RequestStatus,
    description: 'Filter by request status',
  })
  @ApiResponse({
    status: 200,
    description: 'Requests retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ItemRequestResponseDto) },
            },
            total: { type: 'number', example: 8 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 20 },
            message: { example: 'Item requests retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async getItemRequests(
    @Request() req,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('status') status?: RequestStatus,
  ) {
    const ownerId = req.user.userId;
    return this.itemRequestService.getItemRequests(
      ownerId,
      Number(page),
      Number(limit),
      status,
    );
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get details of a specific request' })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Request retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: { example: 'Request retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async getRequestById(@Request() req, @Param('requestId') requestId: string) {
    const userId = req.user.userId;
    return this.itemRequestService.getRequestById(requestId, userId);
  }
}
