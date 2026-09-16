import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { ConversationItemContextDto } from './dto/conversation-item-context.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { ChatUserDto } from './dto/chat-user.dto';
import { MarkReadResponseDto } from './dto/mark-read-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { chatImageUploadOptions } from './chat.constants';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActiveUserGuard } from '../auth/guards/active-user.guard';
import { ServiceResponseDto } from '../common/service-response.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActiveUserGuard)
@ApiExtraModels(
  ServiceResponseDto,
  ConversationResponseDto,
  ConversationItemContextDto,
  ChatUserDto,
  MessageResponseDto,
  MarkReadResponseDto,
  UnreadCountResponseDto,
)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({
    summary: 'Open a conversation with another user',
    description:
      'Returns the existing thread with that user if there is one, otherwise creates it. Passing item_id re-points the thread at that item rather than opening a second one.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ConversationResponseDto) },
            message: { example: 'Conversation retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'One of you has blocked the other' })
  @ApiResponse({ status: 404, description: 'User or item not found' })
  async createConversation(
    @Request() req,
    @Body() createConversationDto: CreateConversationDto,
  ) {
    const userId = req.user.userId;
    return this.chatService.getOrCreateConversation(
      userId,
      createConversationDto,
    );
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List your conversations',
    description:
      'Ordered by most recent activity. Each entry carries the other participant, the item banner, the last message and your unread count.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ConversationResponseDto) },
            },
            total: { type: 'number', example: 12 },
            page: { type: 'number', example: 1 },
            limit: { type: 'number', example: 20 },
            message: { example: 'Conversations retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async listConversations(
    @Request() req,
    @Query() query: QueryConversationsDto,
  ) {
    const userId = req.user.userId;
    return this.chatService.listConversations(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Total unread messages',
    description: 'Drives the badge on the chat tab.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread count retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(UnreadCountResponseDto) },
            message: { example: 'Unread count retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  async getUnreadCount(@Request() req) {
    const userId = req.user.userId;
    return this.chatService.getUnreadCount(userId);
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'Get a single conversation' })
  @ApiParam({ name: 'conversationId', description: 'ID of the conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(ConversationResponseDto) },
            message: { example: 'Conversation retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversation(
    @Request() req,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    const userId = req.user.userId;
    return this.chatService.getConversation(conversationId, userId);
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'Get a page of messages',
    description:
      'Newest first. Pass the id of the oldest message you hold as "before" to fetch the page under it.',
  })
  @ApiParam({ name: 'conversationId', description: 'ID of the conversation' })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(MessageResponseDto) },
            },
            limit: { type: 'number', example: 30 },
            message: { example: 'Messages retrieved successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getMessages(
    @Request() req,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: QueryMessagesDto,
  ) {
    const userId = req.user.userId;
    return this.chatService.getMessages(conversationId, userId, query);
  }

  @Post('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'Send a text message',
    description:
      'The REST twin of the `message:send` socket event. Both parties are notified over their sockets either way.',
  })
  @ApiParam({ name: 'conversationId', description: 'ID of the conversation' })
  @ApiResponse({
    status: 201,
    description: 'Message sent successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(MessageResponseDto) },
            message: { example: 'Message sent successfully' },
            state: { example: true },
            statusCode: { example: 201 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Empty or oversized message' })
  @ApiResponse({ status: 403, description: 'One of you has blocked the other' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async sendMessage(
    @Request() req,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    const userId = req.user.userId;
    return this.chatService.sendMessage(
      userId,
      conversationId,
      sendMessageDto.content ?? '',
    );
  }

  @Post('conversations/:conversationId/messages/image')
  @UseInterceptors(FileInterceptor('image', chatImageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Send an image message',
    description:
      'Uploads the attachment to Cloudinary and posts it as a message.',
  })
  @ApiParam({ name: 'conversationId', description: 'ID of the conversation' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'JPEG, PNG, WebP, GIF or HEIC, up to 10MB',
        },
        caption: {
          type: 'string',
          description: 'Optional text shown under the image',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Image sent successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(MessageResponseDto) },
            message: { example: 'Image sent successfully' },
            state: { example: true },
            statusCode: { example: 201 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 400, description: 'Missing or unsupported image' })
  @ApiResponse({ status: 403, description: 'One of you has blocked the other' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async sendImageMessage(
    @Request() req,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @UploadedFile() image: Express.Multer.File,
    @Body('caption') caption?: string,
  ) {
    const userId = req.user.userId;
    return this.chatService.sendImageMessage(
      userId,
      conversationId,
      image,
      caption,
    );
  }

  @Patch('conversations/:conversationId/read')
  @ApiOperation({
    summary: 'Mark a conversation as read',
    description:
      'Clears your unread count for the thread and sends read receipts to the other party.',
  })
  @ApiParam({ name: 'conversationId', description: 'ID of the conversation' })
  @ApiResponse({
    status: 200,
    description: 'Conversation marked as read',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(MarkReadResponseDto) },
            message: { example: 'Conversation marked as read' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async markAsRead(
    @Request() req,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    const userId = req.user.userId;
    return this.chatService.markAsRead(conversationId, userId);
  }

  @Delete('messages/:messageId')
  @ApiOperation({
    summary: 'Delete your own message',
    description:
      'Retracts the message for both parties. The row stays in the thread as a "message deleted" placeholder.',
  })
  @ApiParam({ name: 'messageId', description: 'ID of the message' })
  @ApiResponse({
    status: 200,
    description: 'Message deleted successfully',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ServiceResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(MessageResponseDto) },
            message: { example: 'Message deleted successfully' },
            state: { example: true },
            statusCode: { example: 200 },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description: 'System messages cannot be deleted',
  })
  @ApiResponse({ status: 403, description: 'Not your message' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async deleteMessage(
    @Request() req,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    const userId = req.user.userId;
    return this.chatService.deleteMessage(messageId, userId);
  }
}
