import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
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
import { CancelRequestDto } from './dto/cancel-request.dto';
// import { ConfirmPickupDto } from './dto/confirm-pickup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../common/decorators/get-user.decorator';
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
    @GetUser('userId') requesterId: string,
    @Body() createItemRequestDto: CreateItemRequestDto,
  ) {
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
    @GetUser('userId') ownerId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.itemRequestService.confirmRequest(ownerId, requestId);
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
    @GetUser('userId') userId: string,
    @Param('requestId') requestId: string,
    @Body() cancelDto: CancelRequestDto,
  ) {
    return this.itemRequestService.cancelRequest(userId, requestId, cancelDto);
  }

  @Patch(':requestId/picked-up')
  @ApiOperation({
    summary: 'Mark the item as picked up (either party)',
    description:
      'Either the owner or the requester taps "Picked up" on a confirmed request. The other party gets a chat card, a push and a `pickup:confirmation_requested` socket event, and must confirm or decline; reminders repeat until they do. If the other party had already marked it, this completes the pickup. Tapping again after marking changes nothing but raises the sheet again.',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Marked, waiting for the other party (or completed)',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: {
              example: 'Waiting for the other person to confirm the pickup',
            },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Request is not confirmed' })
  @ApiResponse({ status: 403, description: 'Not one of the two parties' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({
    status: 409,
    description: 'Item was removed or is no longer reserved',
  })
  async markPickedUp(
    @GetUser('userId') userId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.itemRequestService.markPickedUp(userId, requestId);
  }

  @Patch(':requestId/picked-up/confirm')
  @ApiOperation({
    summary: 'Confirm the other party\'s "Picked up"',
    description:
      'Answer "Yes" on the confirm sheet. Completes the request, marks the item picked up by the requester and closes every other request on it.',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Pickup confirmed',
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
      'Request is not confirmed, nobody marked it, or the caller is the one who marked it',
  })
  @ApiResponse({ status: 403, description: 'Not one of the two parties' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({
    status: 409,
    description: 'Item was removed or is no longer reserved',
  })
  async confirmPickedUp(
    @GetUser('userId') userId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.itemRequestService.confirmPickedUp(userId, requestId);
  }

  @Patch(':requestId/picked-up/decline')
  @ApiOperation({
    summary: 'Decline the other party\'s "Picked up"',
    description:
      'Answer "No" on the confirm sheet. The mark is cleared and the item stays reserved for this request; either side can mark it again later or cancel.',
  })
  @ApiParam({ name: 'requestId', description: 'ID of the request' })
  @ApiResponse({
    status: 200,
    description: 'Pickup declined',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ItemRequestResponseDto) },
            message: {
              example: 'Pickup not confirmed; the item is still reserved',
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
    description:
      'Request is not confirmed, nobody marked it, or the caller is the one who marked it',
  })
  @ApiResponse({ status: 403, description: 'Not one of the two parties' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({
    status: 409,
    description: 'Item was removed or is no longer reserved',
  })
  async declinePickedUp(
    @GetUser('userId') userId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.itemRequestService.declinePickedUp(userId, requestId);
  }

  @Get('pickup-confirmations')
  @ApiOperation({
    summary: 'Pickups waiting on the authenticated user to confirm',
    description:
      'Requests where the other party tapped "Picked up" and this user has not answered, oldest first. Call on app launch and raise the confirm sheet for each.',
  })
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
  @ApiResponse({
    status: 200,
    description: 'Pending confirmations retrieved',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ItemRequestResponseDto) },
            },
            total: { type: 'number', example: 1 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 20 },
            message: {
              example: 'Pending pickup confirmations retrieved successfully',
            },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async getPendingPickupConfirmations(
    @GetUser('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    assertPaging(page, limit);
    return this.itemRequestService.getPendingPickupConfirmations(
      userId,
      page,
      limit,
    );
  }

  /*
   * Code-entry pickup, switched off for now in favour of both parties
   * tapping "Picked up" (see the picked-up routes above). The service
   * methods are kept, so turning it back on is uncommenting these routes
   * and the ConfirmPickupDto import.
   *
   * @Patch(':requestId/pickup')
   * @ApiOperation({
   *   summary: 'Confirm pickup with confirmation code',
   *   description:
   *     'Requester confirms collection with the pickup code the owner hands over in person. Completes the request and closes any other requests for the item.',
   * })
   * @ApiParam({ name: 'requestId', description: 'ID of the request' })
   * @ApiResponse({
   *   status: 200,
   *   description: 'Pickup confirmed successfully',
   *   schema: {
   *     allOf: [
   *       { $ref: getSchemaPath(ServiceResponseDto) },
   *       {
   *         properties: {
   *           data: { $ref: getSchemaPath(ItemRequestResponseDto) },
   *           message: { example: 'Pickup confirmed successfully' },
   *           state: { example: true },
   *           statusCode: { example: 200 },
   *         },
   *       },
   *     ],
   *   },
   * })
   * @ApiResponse({
   *   status: 400,
   *   description:
   *     'Invalid confirmation code; the message says how many attempts are left',
   * })
   * @ApiResponse({
   *   status: 429,
   *   description:
   *     'Too many wrong codes. The owner must issue a new code via PATCH :requestId/pickup-code',
   * })
   * @ApiResponse({ status: 403, description: 'Forbidden' })
   * @ApiResponse({ status: 404, description: 'Request not found' })
   * async confirmPickup(
   *   @GetUser('userId') requesterId: string,
   *   @Param('requestId') requestId: string,
   *   @Body() confirmPickupDto: ConfirmPickupDto,
   * ) {
   *   return this.itemRequestService.confirmPickup(
   *     requesterId,
   *     requestId,
   *     confirmPickupDto.confirmation_code,
   *   );
   * }
   *
   * @Patch(':requestId/pickup-code')
   * @ApiOperation({
   *   summary: 'Issue a new pickup code (owner only)',
   *   description:
   *     'Replaces the pickup code on a confirmed request and resets wrong attempts, unlocking a requester who entered too many wrong codes. The old code stops working.',
   * })
   * @ApiParam({ name: 'requestId', description: 'ID of the request' })
   * @ApiResponse({
   *   status: 200,
   *   description: 'New pickup code issued',
   *   schema: {
   *     allOf: [
   *       { $ref: getSchemaPath(ServiceResponseDto) },
   *       {
   *         properties: {
   *           data: { $ref: getSchemaPath(ItemRequestResponseDto) },
   *           message: { example: 'New pickup code issued' },
   *           state: { example: true },
   *           statusCode: { example: 200 },
   *         },
   *       },
   *     ],
   *   },
   * })
   * @ApiResponse({ status: 400, description: 'Request is not confirmed' })
   * @ApiResponse({ status: 403, description: 'Forbidden' })
   * @ApiResponse({ status: 404, description: 'Request not found' })
   * async regeneratePickupCode(
   *   @GetUser('userId') ownerId: string,
   *   @Param('requestId') requestId: string,
   * ) {
   *   return this.itemRequestService.regeneratePickupCode(ownerId, requestId);
   * }
   *
   * @Patch(':requestId/pickup-code/request')
   * @ApiOperation({
   *   summary: 'Ask the owner for a new pickup code (requester only)',
   *   description:
   *     'For a requester locked out by too many wrong codes. Posts a card in the chat and pushes the owner, who then issues a code via PATCH :requestId/pickup-code. No code is returned to the requester. Can be repeated once an hour.',
   * })
   * @ApiParam({ name: 'requestId', description: 'ID of the request' })
   * @ApiResponse({
   *   status: 200,
   *   description: 'Owner notified',
   *   schema: {
   *     allOf: [
   *       { $ref: getSchemaPath(ServiceResponseDto) },
   *       {
   *         properties: {
   *           data: { $ref: getSchemaPath(ItemRequestResponseDto) },
   *           message: {
   *             example: 'The owner has been asked for a new pickup code',
   *           },
   *           state: { example: true },
   *           statusCode: { example: 200 },
   *         },
   *       },
   *     ],
   *   },
   * })
   * @ApiResponse({
   *   status: 400,
   *   description: 'Request is not confirmed, or pickup is not locked',
   * })
   * @ApiResponse({ status: 403, description: 'Forbidden' })
   * @ApiResponse({ status: 404, description: 'Request not found' })
   * @ApiResponse({
   *   status: 429,
   *   description: 'Already asked within the last hour',
   * })
   * async requestNewPickupCode(
   *   @GetUser('userId') requesterId: string,
   *   @Param('requestId') requestId: string,
   * ) {
   *   return this.itemRequestService.requestNewPickupCode(requesterId, requestId);
   * }
   */

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
    @GetUser('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(RequestStatus, { optional: true }))
    status?: RequestStatus,
  ) {
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
    @GetUser('userId') ownerId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status', new ParseEnumPipe(RequestStatus, { optional: true }))
    status?: RequestStatus,
  ) {
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
  async getRequestById(
    @GetUser('userId') userId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.itemRequestService.getRequestById(requestId, userId);
  }
}
