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
  DefaultValuePipe,
  ParseIntPipe,
  ParseEnumPipe,
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
import { assertPaging, MAX_PAGE_LIMIT } from '../common/assert-paging';

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
    description:
      'Item owner picks which requester gets the item. Reserves the item and generates a pickup code, returned to the owner only.',
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
      'Requester confirms collection with the pickup code the owner hands over in person. Completes the request and closes any other requests for the item.',
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
  @ApiResponse({
    status: 400,
    description:
      'Invalid confirmation code; the message says how many attempts are left',
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many wrong codes. The owner must issue a new code via PATCH :requestId/pickup-code',
  })
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

  @Patch(':requestId/pickup-code')
  @ApiOperation({
    summary: 'Issue a new pickup code (owner only)',
    description:
      'Replaces the pickup code on a confirmed request and resets wrong attempts, unlocking a requester who entered too many wrong codes. The old code stops working.',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'New pickup code issued',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: { example: 'New pickup code issued' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Request is not confirmed' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async regeneratePickupCode(
    @Request() req,
    @Param('requestId') requestId: string,
  ) {
    const ownerId = req.user.userId;
    return this.itemRequestService.regeneratePickupCode(ownerId, requestId);
  }

  @Patch(':requestId/pickup-code/request')
  @ApiOperation({
    summary: 'Ask the owner for a new pickup code (requester only)',
    description:
      'For a requester locked out by too many wrong codes. Posts a card in the chat and pushes the owner, who then issues a code via PATCH :requestId/pickup-code. No code is returned to the requester. Can be repeated once an hour.',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Owner notified',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: {
              example: 'The owner has been asked for a new pickup code',
            },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Request is not confirmed, or pickup is not locked',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({
    status: 429,
    description: 'Already asked within the last hour',
  })
  async requestNewPickupCode(
    @Request() req,
    @Param('requestId') requestId: string,
  ) {
    const requesterId = req.user.userId;
    return this.itemRequestService.requestNewPickupCode(requesterId, requestId);
  }

  @Get('my-requests')
  @ApiOperation({ summary: 'Get all requests made by the authenticated user' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    minimum: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
  })
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
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(RequestStatus, { optional: true }))
    status?: RequestStatus,
  ) {
    const userId = req.user.userId;
    assertPaging(page, limit);
    return this.itemRequestService.getUserRequests(userId, page, limit, status);
  }

  @Get('received')
  @ApiOperation({ summary: 'Get all requests received for your items' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    minimum: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
  })
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
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(RequestStatus, { optional: true }))
    status?: RequestStatus,
  ) {
    const ownerId = req.user.userId;
    assertPaging(page, limit);
    return this.itemRequestService.getItemRequests(
      ownerId,
      page,
      limit,
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
