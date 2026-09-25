import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { ConversationEntity } from './entities/conversation.entity';
import {
  MessageEntity,
  MessageType,
  SystemEvent,
} from './entities/message.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { ConversationItemContextDto } from './dto/conversation-item-context.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { ChatUserDto } from './dto/chat-user.dto';
import { MarkReadResponseDto } from './dto/mark-read-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { ChatRealtimeService } from './chat-realtime.service';
import {
  ChatEvents,
  CHAT_IMAGE_FOLDER,
  MESSAGE_PREVIEW_LENGTH,
} from './chat.constants';

import { UserEntity } from '../user/entities/user.entity';
import { ItemEntity } from '../item/entities/item.entity';
import {
  ItemRequestEntity,
  RequestStatus,
} from '../item-request/entities/item-request.entity';
import { BlockedUser } from '../moderation/entities/blocked-user.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ServiceResponseDto } from '../common/service-response.dto';
import { AppError } from '../common/app-error';

/** Which side of the canonical pair a user sits on. See ConversationEntity. */
type PairSide = 'a' | 'b';

export interface SystemMessageParams {
  /** The user whose action caused the event. */
  actorId: string;
  /** The other party to the item handover. */
  otherUserId: string;
  event: SystemEvent;
  itemId?: string | null;
  requestId?: string | null;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepository: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
    @InjectRepository(ItemRequestEntity)
    private readonly itemRequestRepository: Repository<ItemRequestEntity>,
    @InjectRepository(BlockedUser)
    private readonly blockedUserRepository: Repository<BlockedUser>,
    private readonly dataSource: DataSource,
    private readonly cloudinaryService: CloudinaryService,
    private readonly firebaseService: FirebaseService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Pair helpers
  // ---------------------------------------------------------------------------

  /**
   * Put a pair of user ids in the canonical order the table is keyed on, so
   * that (a, b) and (b, a) address the same row.
   */
  private orderPair(one: string, two: string): [string, string] {
    return one < two ? [one, two] : [two, one];
  }

  private sideOf(
    conversation: ConversationEntity,
    userId: string,
  ): PairSide | null {
    if (conversation.user_a_id === userId) return 'a';
    if (conversation.user_b_id === userId) return 'b';
    return null;
  }

  private assertParticipant(
    conversation: ConversationEntity,
    userId: string,
  ): PairSide {
    const side = this.sideOf(conversation, userId);

    if (!side) {
      // Deliberately the same 404 an unknown id gets: telling a stranger that
      // a conversation exists but is not theirs leaks that two users are
      // talking.
      throw new NotFoundException('Conversation not found');
    }

    return side;
  }

  private otherParticipantId(
    conversation: ConversationEntity,
    userId: string,
  ): string {
    return conversation.user_a_id === userId
      ? conversation.user_b_id
      : conversation.user_a_id;
  }

  private unreadColumn(
    side: PairSide,
  ): 'user_a_unread_count' | 'user_b_unread_count' {
    return side === 'a' ? 'user_a_unread_count' : 'user_b_unread_count';
  }

  private lastReadColumn(
    side: PairSide,
  ): 'user_a_last_read_at' | 'user_b_last_read_at' {
    return side === 'a' ? 'user_a_last_read_at' : 'user_b_last_read_at';
  }

  private unreadCountFor(
    conversation: ConversationEntity,
    side: PairSide,
  ): number {
    return side === 'a'
      ? conversation.user_a_unread_count
      : conversation.user_b_unread_count;
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  /**
   * Refuse the exchange if either user has blocked the other.
   *
   * Checked in both directions: the blocker must not receive messages from
   * the person they blocked, and the blocked user must not be able to keep
   * writing into the thread.
   */
  private async assertNotBlocked(
    userId: string,
    otherUserId: string,
  ): Promise<void> {
    const block = await this.blockedUserRepository.findOne({
      where: [
        { blockerId: userId, blockedId: otherUserId, isDeleted: false },
        { blockerId: otherUserId, blockedId: userId, isDeleted: false },
      ],
    });

    if (block) {
      // Worded the same either way round, so it does not reveal which
      // direction the block runs in.
      throw new ForbiddenException(
        'You can no longer exchange messages with this user',
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === '23505'
    );
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  /**
   * The publicly shareable view of a participant.
   *
   * Fields are copied one by one rather than with Object.assign: the loaded
   * relation is a full UserEntity row, and assigning it wholesale would put
   * every user column - password_hash included - on the wire, and would
   * silently do so again for any column added later.
   */
  private toChatUser(user: UserEntity): ChatUserDto {
    return {
      id: user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      profile_image: user.cloudinary_avatar_url ?? null,
      is_online: this.realtime.isOnline(user.id),
      last_active: user.last_active ?? null,
    };
  }

  private toMessageDto(
    entity: MessageEntity,
    viewerId: string,
  ): MessageResponseDto {
    const dto = new MessageResponseDto();
    dto.id = entity.id;
    dto.conversation_id = entity.conversation_id;
    dto.sender_id = entity.sender_id;
    dto.recipient_id = entity.recipient_id;
    dto.is_mine = entity.sender_id === viewerId;
    dto.message_type = entity.message_type;
    dto.system_event = entity.system_event ?? null;
    dto.created_at = entity.created_at;
    dto.read_at = entity.read_at ?? null;
    dto.is_read = entity.read_at !== null && entity.read_at !== undefined;
    dto.is_deleted = entity.is_deleted;

    // A deleted message keeps its place in the thread - clients render a
    // "message deleted" placeholder - but its body must not travel with it.
    if (entity.is_deleted) {
      dto.content = null;
      dto.metadata = null;
      dto.image_url = null;
      dto.image_width = null;
      dto.image_height = null;
      return dto;
    }

    dto.content = entity.content ?? null;
    dto.metadata = entity.metadata ?? null;
    dto.image_url = entity.image_url ?? null;
    dto.image_width = entity.image_width ?? null;
    dto.image_height = entity.image_height ?? null;

    return dto;
  }

  /**
   * One-line summary stored on the conversation for the chat list.
   *
   * System events are summarised from the actor's point of view; the list
   * shows the same string to both sides, which reads correctly either way
   * ("Item requested", "Picked up").
   */
  private buildPreview(message: MessageEntity): string {
    if (message.is_deleted) {
      return 'Message deleted';
    }

    if (message.message_type === MessageType.SYSTEM) {
      switch (message.system_event) {
        case SystemEvent.ITEM_REQUESTED:
          return 'Item requested';
        case SystemEvent.REQUEST_CONFIRMED:
          return 'Request confirmed';
        case SystemEvent.REQUEST_CANCELLED:
          return 'Request cancelled';
        case SystemEvent.PICKUP_CONFIRMED:
          return 'Item picked up';
        default:
          return 'Update';
      }
    }

    if (message.message_type === MessageType.IMAGE) {
      return message.content
        ? `Photo: ${message.content}`.slice(0, MESSAGE_PREVIEW_LENGTH)
        : 'Photo';
    }

    return (message.content ?? '').slice(0, MESSAGE_PREVIEW_LENGTH);
  }

  // ---------------------------------------------------------------------------
  // Item context (the banner above the message list)
  // ---------------------------------------------------------------------------

  private primaryImageUrl(item: ItemEntity): string | null {
    const images = (item.images ?? []).filter((image) => !image.is_deleted);

    if (images.length === 0) {
      return null;
    }

    const primary =
      images.find((image) => image.is_primary) ??
      [...images].sort((a, b) => a.display_order - b.display_order)[0];

    return primary?.cloudinary_secure_url ?? primary?.cloudinary_url ?? null;
  }

  /**
   * Build the item banner for a set of conversations in three queries rather
   * than three per row.
   *
   * The requester of an item is whichever participant does not own it, so the
   * request lookup is keyed on (item_id, requester_id) and the newest matching
   * request wins - a cancelled request followed by a fresh one shows the
   * fresh one.
   */
  private async buildItemContexts(
    conversations: ConversationEntity[],
    viewerId: string,
  ): Promise<Map<string, ConversationItemContextDto>> {
    const contexts = new Map<string, ConversationItemContextDto>();

    const itemIds = [
      ...new Set(
        conversations
          .map((conversation) => conversation.item_id)
          .filter((itemId): itemId is string => Boolean(itemId)),
      ),
    ];

    if (itemIds.length === 0) {
      return contexts;
    }

    const items = await this.itemRepository.find({
      where: { id: In(itemIds) },
      relations: ['images'],
    });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    // Candidate requesters are the non-owning participant of each thread.
    const requesterIds = [
      ...new Set(
        conversations.flatMap((conversation) => {
          const item = conversation.item_id
            ? itemsById.get(conversation.item_id)
            : undefined;

          if (!item) return [];

          return [this.otherParticipantId(conversation, item.user_id)];
        }),
      ),
    ];

    const requests = requesterIds.length
      ? await this.itemRequestRepository.find({
          where: { item_id: In(itemIds), requester_id: In(requesterIds) },
          order: { created_at: 'DESC' },
        })
      : [];

    // Newest first above, so the first hit for a key is the current request.
    const latestRequest = new Map<string, ItemRequestEntity>();
    for (const request of requests) {
      const key = `${request.item_id}:${request.requester_id}`;
      if (!latestRequest.has(key)) {
        latestRequest.set(key, request);
      }
    }

    for (const conversation of conversations) {
      const item = conversation.item_id
        ? itemsById.get(conversation.item_id)
        : undefined;

      if (!item) {
        continue;
      }

      const requesterId = this.otherParticipantId(conversation, item.user_id);
      const request = latestRequest.get(`${item.id}:${requesterId}`) ?? null;

      const context = new ConversationItemContextDto();
      context.id = item.id;
      context.title = item.title;
      context.image_url = this.primaryImageUrl(item);
      context.status = item.status;
      context.owner_id = item.user_id;
      context.is_mine = item.user_id === viewerId;
      context.request_id = request?.id ?? null;
      context.request_status = request?.status ?? null;
      context.picked_up_at = request?.picked_up_at ?? null;
      context.is_pending_pickup =
        request !== null &&
        !request.is_picked_up &&
        (request.status === RequestStatus.PENDING ||
          request.status === RequestStatus.CONFIRMED);

      contexts.set(conversation.id, context);
    }

    return contexts;
  }

  /**
   * Newest message per conversation, in one round trip.
   *
   * DISTINCT ON is Postgres-specific and has no query-builder equivalent, so
   * this is raw SQL. The ordering matches the pagination index, and the id
   * tiebreak keeps it deterministic for messages sharing a timestamp.
   */
  private async fetchLastMessages(
    conversationIds: string[],
  ): Promise<Map<string, MessageEntity>> {
    const byConversation = new Map<string, MessageEntity>();

    if (conversationIds.length === 0) {
      return byConversation;
    }

    // Column names match the entity's property names one for one, so the raw
    // rows need no mapping beyond this cast.
    const rows = await this.messageRepository.query<MessageEntity[]>(
      `SELECT DISTINCT ON (conversation_id) *
         FROM chat_messages
        WHERE conversation_id = ANY($1::uuid[])
        ORDER BY conversation_id, created_at DESC, id DESC`,
      [conversationIds],
    );

    for (const row of rows) {
      byConversation.set(row.conversation_id, row);
    }

    return byConversation;
  }

  private toConversationDto(
    conversation: ConversationEntity,
    viewerId: string,
    side: PairSide,
    lastMessage: MessageEntity | null,
    itemContext: ConversationItemContextDto | null,
  ): ConversationResponseDto {
    const other = side === 'a' ? conversation.userB : conversation.userA;

    const dto = new ConversationResponseDto();
    dto.id = conversation.id;
    dto.participant = this.toChatUser(other);
    dto.item = itemContext;
    dto.last_message = lastMessage
      ? this.toMessageDto(lastMessage, viewerId)
      : null;
    dto.last_message_at = conversation.last_message_at ?? null;
    dto.unread_count = this.unreadCountFor(conversation, side);
    dto.created_at = conversation.created_at;
    dto.updated_at = conversation.updated_at;

    return dto;
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * Open the thread with another user, creating it on first contact.
   *
   * There is one thread per pair for all time, so passing a different
   * `item_id` re-points the existing thread at that item rather than opening
   * a second one.
   */
  async getOrCreateConversation(
    userId: string,
    dto: CreateConversationDto,
  ): Promise<ServiceResponseDto<ConversationResponseDto>> {
    try {
      const { recipient_id: recipientId, item_id: itemId } = dto;

      if (recipientId === userId) {
        throw new BadRequestException('You cannot start a chat with yourself');
      }

      const recipient = await this.userRepository.findOne({
        where: { id: recipientId, is_deleted: false },
      });

      if (!recipient) {
        throw new NotFoundException('User not found');
      }

      await this.assertNotBlocked(userId, recipientId);

      if (itemId) {
        const item = await this.itemRepository.findOne({
          where: { id: itemId, is_deleted: false },
        });

        if (!item) {
          throw new NotFoundException('Item not found');
        }

        // The banner shows an owner and a requester, which only makes sense
        // if one of the two people talking actually owns the item.
        if (item.user_id !== userId && item.user_id !== recipientId) {
          throw new BadRequestException(
            'The item must belong to one of the participants',
          );
        }
      }

      const conversation = await this.resolveConversation(
        userId,
        recipientId,
        itemId ?? null,
      );

      const loaded = await this.loadConversationForViewer(
        conversation.id,
        userId,
      );

      return {
        message: 'Conversation retrieved successfully',
        data: loaded,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error opening conversation: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Find the pair's thread, or insert it.
   *
   * The unique index on (user_a_id, user_b_id) is the real guard: two devices
   * opening the same chat at once both miss the SELECT, and the loser of the
   * INSERT re-reads the winner's row instead of failing.
   */
  private async resolveConversation(
    userId: string,
    otherUserId: string,
    itemId: string | null,
    manager?: EntityManager,
  ): Promise<ConversationEntity> {
    const repository = manager
      ? manager.getRepository(ConversationEntity)
      : this.conversationRepository;

    const [userAId, userBId] = this.orderPair(userId, otherUserId);

    const existing = await repository.findOne({
      where: { user_a_id: userAId, user_b_id: userBId },
    });

    if (existing) {
      if (itemId && existing.item_id !== itemId) {
        existing.item_id = itemId;
        await repository.update({ id: existing.id }, { item_id: itemId });
      }

      return existing;
    }

    try {
      return await repository.save(
        repository.create({
          user_a_id: userAId,
          user_b_id: userBId,
          item_id: itemId,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      const raced = await repository.findOne({
        where: { user_a_id: userAId, user_b_id: userBId },
      });

      if (!raced) {
        throw error;
      }

      return raced;
    }
  }

  /** Load one conversation, shaped for a participant. */
  private async loadConversationForViewer(
    conversationId: string,
    viewerId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ['userA', 'userB'],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const side = this.assertParticipant(conversation, viewerId);

    const [lastMessages, itemContexts] = await Promise.all([
      this.fetchLastMessages([conversation.id]),
      this.buildItemContexts([conversation], viewerId),
    ]);

    return this.toConversationDto(
      conversation,
      viewerId,
      side,
      lastMessages.get(conversation.id) ?? null,
      itemContexts.get(conversation.id) ?? null,
    );
  }

  /** The chat list: every thread the user is in, newest activity first. */
  async listConversations(
    userId: string,
    query: QueryConversationsDto,
  ): Promise<ServiceResponseDto<ConversationResponseDto[]>> {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const skip = (page - 1) * limit;

      const queryBuilder = this.conversationRepository
        .createQueryBuilder('conversation')
        .leftJoinAndSelect('conversation.userA', 'userA')
        .leftJoinAndSelect('conversation.userB', 'userB')
        .where(
          new Brackets((qb) => {
            qb.where('conversation.user_a_id = :userId', { userId }).orWhere(
              'conversation.user_b_id = :userId',
              { userId },
            );
          }),
        )
        // A thread with no messages yet sorts by when it was opened, so it
        // does not fall to the bottom of the list before the first reply.
        // The expression is selected under an alias because skip/take with
        // joins makes TypeORM parse ORDER BY keys as `alias.property`, which
        // a raw COALESCE(...) cannot satisfy.
        .addSelect(
          'COALESCE(conversation.last_message_at, conversation.created_at)',
          'activity_at',
        )
        .orderBy('activity_at', 'DESC')
        .addOrderBy('conversation.id', 'DESC')
        .skip(skip)
        .take(limit);

      const search = query.search?.trim();

      if (search) {
        const pattern = `%${search}%`;

        // Which name to match depends on which side of the pair the searcher
        // is on, so each side is spelled out rather than matching both users.
        queryBuilder.andWhere(
          new Brackets((qb) => {
            qb.where(
              new Brackets((inner) => {
                inner
                  .where('conversation.user_a_id = :userId', { userId })
                  .andWhere(
                    "(userB.first_name ILIKE :pattern OR userB.last_name ILIKE :pattern OR COALESCE(userB.first_name, '') || ' ' || COALESCE(userB.last_name, '') ILIKE :pattern)",
                    { pattern },
                  );
              }),
            )
              .orWhere(
                new Brackets((inner) => {
                  inner
                    .where('conversation.user_b_id = :userId', { userId })
                    .andWhere(
                      "(userA.first_name ILIKE :pattern OR userA.last_name ILIKE :pattern OR COALESCE(userA.first_name, '') || ' ' || COALESCE(userA.last_name, '') ILIKE :pattern)",
                      { pattern },
                    );
                }),
              )
              .orWhere('conversation.last_message_preview ILIKE :pattern', {
                pattern,
              });
          }),
        );
      }

      const [conversations, total] = await queryBuilder.getManyAndCount();

      const conversationIds = conversations.map(
        (conversation) => conversation.id,
      );

      const [lastMessages, itemContexts] = await Promise.all([
        this.fetchLastMessages(conversationIds),
        this.buildItemContexts(conversations, userId),
      ]);

      const data = conversations.map((conversation) =>
        this.toConversationDto(
          conversation,
          userId,
          this.assertParticipant(conversation, userId),
          lastMessages.get(conversation.id) ?? null,
          itemContexts.get(conversation.id) ?? null,
        ),
      );

      return {
        message: 'Conversations retrieved successfully',
        data,
        total,
        page,
        limit,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error listing conversations: ${error.message}`,
          error.stack,
        );
      }
      // A query failure's message names SQL aliases and columns, so only
      // deliberate HTTP errors reach the client as they are.
      if (error instanceof HttpException) throw new AppError(error);
      throw new AppError(
        new InternalServerErrorException(
          'Could not load conversations. Please try again.',
        ),
      );
    }
  }

  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<ServiceResponseDto<ConversationResponseDto>> {
    try {
      return {
        message: 'Conversation retrieved successfully',
        data: await this.loadConversationForViewer(conversationId, userId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching conversation: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * One page of a thread, newest first.
   *
   * Paged on the (created_at, id) tuple rather than an offset: a thread gains
   * messages while it is being scrolled, and OFFSET would skip or repeat rows
   * as everything shifts under it.
   */
  async getMessages(
    conversationId: string,
    userId: string,
    query: QueryMessagesDto,
  ): Promise<ServiceResponseDto<MessageResponseDto[]>> {
    try {
      const limit = query.limit ?? 30;

      const conversation = await this.conversationRepository.findOne({
        where: { id: conversationId },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      this.assertParticipant(conversation, userId);

      const queryBuilder = this.messageRepository
        .createQueryBuilder('message')
        .where('message.conversation_id = :conversationId', { conversationId })
        .orderBy('message.created_at', 'DESC')
        .addOrderBy('message.id', 'DESC')
        .take(limit);

      if (query.before) {
        const cursor = await this.messageRepository.findOne({
          where: { id: query.before, conversation_id: conversationId },
          select: { id: true, created_at: true },
        });

        if (!cursor) {
          throw new BadRequestException(
            'The "before" cursor does not belong to this conversation',
          );
        }

        // Compared against the cursor row inside SQL: created_at has
        // microsecond precision, and a round trip through a JS Date keeps
        // only milliseconds, which skipped older messages in the cursor's
        // millisecond.
        queryBuilder.andWhere(
          '(message.created_at, message.id) < (SELECT c.created_at, c.id FROM chat_messages c WHERE c.id = :cursorId)',
          { cursorId: cursor.id },
        );
      }

      const messages = await queryBuilder.getMany();

      return {
        message: 'Messages retrieved successfully',
        data: messages.map((message) => this.toMessageDto(message, userId)),
        limit,
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching messages: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Insert a message and move the conversation's denormalised summary with it.
   *
   * Both writes happen in one transaction, and the recipient's unread counter
   * is incremented in SQL rather than read-modify-written, so two messages
   * arriving at once cannot lose a count.
   */
  private async persistMessage(
    conversation: ConversationEntity,
    senderId: string,
    recipientId: string,
    draft: Partial<MessageEntity>,
  ): Promise<MessageEntity> {
    return this.dataSource.transaction(async (manager) => {
      const message = manager.create(MessageEntity, {
        conversation_id: conversation.id,
        sender_id: senderId,
        recipient_id: recipientId,
        message_type: MessageType.TEXT,
        ...draft,
      });

      const saved = await manager.save(message);

      const recipientSide = this.sideOf(conversation, recipientId);

      if (!recipientSide) {
        throw new NotFoundException('Conversation not found');
      }

      const unreadColumn = this.unreadColumn(recipientSide);

      const updates: QueryDeepPartialEntity<ConversationEntity> = {
        last_message_at: saved.created_at,
        last_message_preview: this.buildPreview(saved),
        last_message_sender_id: senderId,
      };
      updates[unreadColumn] = () => `"${unreadColumn}" + 1`;

      await manager
        .createQueryBuilder()
        .update(ConversationEntity)
        .set(updates)
        .where('id = :id', { id: conversation.id })
        .execute();

      return saved;
    });
  }

  /**
   * Fan a newly stored message out to both parties and, if the recipient has
   * no live socket, to their phone.
   *
   * Everything here runs after the message is committed and is best-effort:
   * a failed push must not turn a delivered message into an error.
   */
  private async broadcastMessage(
    message: MessageEntity,
    conversation: ConversationEntity,
  ): Promise<void> {
    const { sender_id: senderId, recipient_id: recipientId } = message;

    this.realtime.emitToUser(
      recipientId,
      ChatEvents.MESSAGE_NEW,
      this.toMessageDto(message, recipientId),
    );
    // Echoed to the sender's other devices so they stay in step.
    this.realtime.emitToUser(
      senderId,
      ChatEvents.MESSAGE_NEW,
      this.toMessageDto(message, senderId),
    );

    for (const participantId of [senderId, recipientId]) {
      this.realtime.emitToUser(participantId, ChatEvents.CONVERSATION_UPDATED, {
        conversation_id: conversation.id,
        last_message_at: message.created_at,
        last_message_preview: this.buildPreview(message),
      });
    }

    if (this.realtime.isOnline(recipientId)) {
      return;
    }

    await this.sendPushNotification(message, conversation);
  }

  private async sendPushNotification(
    message: MessageEntity,
    conversation: ConversationEntity,
  ): Promise<void> {
    try {
      const [recipient, sender] = await Promise.all([
        this.userRepository.findOne({
          where: { id: message.recipient_id },
          select: {
            id: true,
            fcm_token: true,
            notification_enabled: true,
            is_active: true,
          },
        }),
        this.userRepository.findOne({
          where: { id: message.sender_id },
          select: { id: true, first_name: true, last_name: true },
        }),
      ]);

      if (
        !recipient?.fcm_token ||
        !recipient.notification_enabled ||
        !recipient.is_active
      ) {
        return;
      }

      const senderName =
        [sender?.first_name, sender?.last_name].filter(Boolean).join(' ') ||
        'Someone';

      await this.firebaseService.sendNotification(recipient.fcm_token, {
        title: senderName,
        body: this.buildPreview(message),
        data: {
          type: 'chat_message',
          conversation_id: conversation.id,
          message_id: message.id,
          sender_id: message.sender_id,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to push chat notification: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Load a thread for writing: caller must be in it, and neither side blocked. */
  private async loadWritableConversation(
    conversationId: string,
    senderId: string,
  ): Promise<{ conversation: ConversationEntity; recipientId: string }> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    this.assertParticipant(conversation, senderId);

    const recipientId = this.otherParticipantId(conversation, senderId);
    await this.assertNotBlocked(senderId, recipientId);

    return { conversation, recipientId };
  }

  /** Send a text message. Shared by the REST endpoint and the gateway. */
  async sendMessage(
    senderId: string,
    conversationId: string,
    content: string,
  ): Promise<ServiceResponseDto<MessageResponseDto>> {
    try {
      const trimmed = content?.trim();

      if (!trimmed) {
        throw new BadRequestException('Message content cannot be empty');
      }

      const { conversation, recipientId } = await this.loadWritableConversation(
        conversationId,
        senderId,
      );

      const message = await this.persistMessage(
        conversation,
        senderId,
        recipientId,
        { message_type: MessageType.TEXT, content: trimmed },
      );

      await this.broadcastMessage(message, conversation);

      return {
        message: 'Message sent successfully',
        data: this.toMessageDto(message, senderId),
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error sending message: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Send an image, with an optional caption.
   *
   * The upload happens before the row is written so that a Cloudinary failure
   * leaves nothing behind; the cost is an orphaned asset if the insert then
   * fails, which is the cheaper of the two leaks.
   */
  async sendImageMessage(
    senderId: string,
    conversationId: string,
    file: Express.Multer.File,
    caption?: string,
  ): Promise<ServiceResponseDto<MessageResponseDto>> {
    try {
      if (!file) {
        throw new BadRequestException('An image file is required');
      }

      const { conversation, recipientId } = await this.loadWritableConversation(
        conversationId,
        senderId,
      );

      const upload = await this.cloudinaryService.uploadImage(file, {
        folder: `${CHAT_IMAGE_FOLDER}/${conversationId}`,
      });

      const message = await this.persistMessage(
        conversation,
        senderId,
        recipientId,
        {
          message_type: MessageType.IMAGE,
          content: caption?.trim() || null,
          image_url: upload.secureUrl,
          image_public_id: upload.publicId,
          image_width: upload.width ?? null,
          image_height: upload.height ?? null,
        },
      );

      await this.broadcastMessage(message, conversation);

      return {
        message: 'Image sent successfully',
        data: this.toMessageDto(message, senderId),
        state: true,
        statusCode: 201,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error sending image message: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Mark everything addressed to the caller in this thread as read.
   *
   * The counter is set to zero rather than decremented, so it re-syncs even
   * if it had drifted, and the stamped ids go back to the sender as receipts.
   */
  async markAsRead(
    conversationId: string,
    userId: string,
  ): Promise<ServiceResponseDto<MarkReadResponseDto>> {
    try {
      const conversation = await this.conversationRepository.findOne({
        where: { id: conversationId },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const side = this.assertParticipant(conversation, userId);
      const readAt = new Date();

      const messageIds = await this.dataSource.transaction(async (manager) => {
        const result = await manager
          .createQueryBuilder()
          .update(MessageEntity)
          .set({ read_at: readAt })
          .where('conversation_id = :conversationId', { conversationId })
          .andWhere('recipient_id = :userId', { userId })
          .andWhere('read_at IS NULL')
          .returning(['id'])
          .execute();

        const updates: QueryDeepPartialEntity<ConversationEntity> = {};
        updates[this.unreadColumn(side)] = 0;
        updates[this.lastReadColumn(side)] = readAt;

        await manager
          .createQueryBuilder()
          .update(ConversationEntity)
          .set(updates)
          .where('id = :id', { id: conversationId })
          .execute();

        return ((result.raw as { id: string }[]) ?? []).map((row) => row.id);
      });

      if (messageIds.length > 0) {
        // The receipt goes to the other party, whose bubbles just turned read.
        this.realtime.emitToUser(
          this.otherParticipantId(conversation, userId),
          ChatEvents.MESSAGE_READ,
          {
            conversation_id: conversationId,
            reader_id: userId,
            message_ids: messageIds,
            read_at: readAt,
          },
        );
      }

      // The reader's own devices need to clear the badge.
      this.realtime.emitToUser(userId, ChatEvents.CONVERSATION_UPDATED, {
        conversation_id: conversationId,
        unread_count: 0,
      });

      return {
        message: 'Conversation marked as read',
        data: {
          conversation_id: conversationId,
          marked_count: messageIds.length,
          message_ids: messageIds,
          read_at: readAt,
        },
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error marking conversation as read: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * Retract a message for both sides.
   *
   * The row is kept so the thread does not renumber under a client that is
   * mid-scroll; the body is blanked on the way out by toMessageDto.
   */
  async deleteMessage(
    messageId: string,
    userId: string,
  ): Promise<ServiceResponseDto<MessageResponseDto>> {
    try {
      const message = await this.messageRepository.findOne({
        where: { id: messageId },
      });

      if (!message) {
        throw new NotFoundException('Message not found');
      }

      if (message.sender_id !== userId) {
        throw new ForbiddenException('You can only delete your own messages');
      }

      if (message.message_type === MessageType.SYSTEM) {
        throw new BadRequestException('System messages cannot be deleted');
      }

      if (message.is_deleted) {
        return {
          message: 'Message already deleted',
          data: this.toMessageDto(message, userId),
          state: true,
          statusCode: 200,
        };
      }

      const conversation = await this.conversationRepository.findOne({
        where: { id: message.conversation_id },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const deletedAt = new Date();
      const wasUnread = message.read_at === null;
      const recipientSide = this.sideOf(conversation, message.recipient_id);

      await this.dataSource.transaction(async (manager) => {
        await manager.update(
          MessageEntity,
          { id: messageId },
          {
            is_deleted: true,
            deleted_at: deletedAt,
            content: null,
            metadata: null,
            image_url: null,
            image_public_id: null,
            image_width: null,
            image_height: null,
          },
        );

        // Deleting an unread message takes it out of the recipient's badge.
        // GREATEST keeps the counter from going negative if it had drifted.
        if (wasUnread && recipientSide) {
          const column = this.unreadColumn(recipientSide);
          const updates: QueryDeepPartialEntity<ConversationEntity> = {};
          updates[column] = () => `GREATEST("${column}" - 1, 0)`;

          await manager
            .createQueryBuilder()
            .update(ConversationEntity)
            .set(updates)
            .where('id = :id', { id: conversation.id })
            .execute();
        }

        // If this was the newest message, the list preview has to follow it.
        if (
          conversation.last_message_at &&
          message.created_at.getTime() ===
            conversation.last_message_at.getTime()
        ) {
          await manager
            .createQueryBuilder()
            .update(ConversationEntity)
            .set({ last_message_preview: 'Message deleted' })
            .where('id = :id', { id: conversation.id })
            .execute();
        }
      });

      // Best-effort: the row is already retracted, and a failed asset delete
      // must not fail the request.
      if (message.image_public_id) {
        try {
          await this.cloudinaryService.deleteImage(message.image_public_id);
        } catch (error) {
          this.logger.warn(
            `Failed to delete chat image from Cloudinary: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }

      const deleted = { ...message, is_deleted: true, deleted_at: deletedAt };

      this.realtime.emitToUsers(
        [message.sender_id, message.recipient_id],
        ChatEvents.MESSAGE_DELETED,
        { conversation_id: message.conversation_id, message_id: messageId },
      );

      return {
        message: 'Message deleted successfully',
        data: this.toMessageDto(deleted, userId),
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error deleting message: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  /**
   * The unread badge on the chat tab.
   *
   * Aggregated in the database rather than by loading every conversation: a
   * long-standing user has a row per person they have ever talked to, and all
   * this needs from them is two numbers.
   */
  async getUnreadCount(
    userId: string,
  ): Promise<ServiceResponseDto<UnreadCountResponseDto>> {
    try {
      const rows = await this.conversationRepository.query<
        { total: number; with_unread: number }[]
      >(
        `SELECT COALESCE(SUM(unread), 0)::int AS total,
                COUNT(*) FILTER (WHERE unread > 0)::int AS with_unread
           FROM (
             SELECT CASE
                      WHEN user_a_id = $1 THEN user_a_unread_count
                      ELSE user_b_unread_count
                    END AS unread
               FROM conversations
              WHERE user_a_id = $1 OR user_b_id = $1
           ) counts`,
        [userId],
      );

      const row = rows[0];

      return {
        message: 'Unread count retrieved successfully',
        data: {
          total_unread: Number(row?.total ?? 0),
          conversations_with_unread: Number(row?.with_unread ?? 0),
        },
        state: true,
        statusCode: 200,
      };
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Error fetching unread count: ${error.message}`,
          error.stack,
        );
      }
      throw new AppError(error);
    }
  }

  // ---------------------------------------------------------------------------
  // System messages
  // ---------------------------------------------------------------------------

  /**
   * Drop a system card into the actor's thread with the other party - the
   * "You've requested for Ivan's item!" row in the mockups.
   *
   * Called by the item-request flow after its own transaction has committed,
   * and deliberately swallows every error: a chat write must never be able to
   * roll back or fail a request, confirmation or pickup that already
   * succeeded. Failures are logged instead.
   *
   * The block check the human send path performs is skipped here, because
   * these rows are a record of something that already happened between the
   * two users rather than a new approach from one to the other.
   */
  async createSystemMessage(params: SystemMessageParams): Promise<void> {
    const { actorId, otherUserId, event, itemId, requestId } = params;

    try {
      if (actorId === otherUserId) {
        return;
      }

      const item = itemId
        ? await this.itemRepository.findOne({
            where: { id: itemId },
            relations: ['images'],
          })
        : null;

      const conversation = await this.resolveConversation(
        actorId,
        otherUserId,
        item?.id ?? null,
      );

      const message = await this.persistMessage(
        conversation,
        actorId,
        otherUserId,
        {
          message_type: MessageType.SYSTEM,
          system_event: event,
          content: null,
          // Snapshotted rather than joined, so the card still renders after
          // the item is edited or deleted.
          metadata: {
            item_id: item?.id ?? itemId ?? null,
            item_title: item?.title ?? null,
            item_image_url: item ? this.primaryImageUrl(item) : null,
            request_id: requestId ?? null,
          },
        },
      );

      await this.broadcastMessage(message, conversation);
    } catch (error) {
      this.logger.warn(
        `Failed to record chat system message "${event}": ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Realtime side-channels
  // ---------------------------------------------------------------------------

  /**
   * Relay a typing indicator to the other participant.
   *
   * Nothing is stored: if the sender drops off mid-type, the indicator dies
   * with the TYPING_TIMEOUT_MS the client is told to expire it after.
   */
  async relayTyping(
    userId: string,
    conversationId: string,
    isTyping: boolean,
  ): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation || !this.sideOf(conversation, userId)) {
      return;
    }

    const recipientId = this.otherParticipantId(conversation, userId);

    this.realtime.emitToUser(recipientId, ChatEvents.TYPING, {
      conversation_id: conversationId,
      user_id: userId,
      is_typing: isTyping,
    });
  }

  /**
   * Tell everyone this user has a thread with that they came online or went
   * offline, so their chat list and thread headers update live.
   *
   * Only participants who are themselves connected are emitted to - the rest
   * pick the state up from `participant.is_online` on their next fetch.
   */
  async broadcastPresence(userId: string, isOnline: boolean): Promise<void> {
    try {
      const lastActive = new Date();

      if (!isOnline) {
        await this.userRepository.update(
          { id: userId },
          { last_active: lastActive },
        );
      }

      const conversations = await this.conversationRepository.find({
        where: [{ user_a_id: userId }, { user_b_id: userId }],
        select: { id: true, user_a_id: true, user_b_id: true },
      });

      const partnerIds = new Set(
        conversations.map((conversation) =>
          this.otherParticipantId(conversation, userId),
        ),
      );

      for (const partnerId of partnerIds) {
        if (!this.realtime.isOnline(partnerId)) {
          continue;
        }

        this.realtime.emitToUser(partnerId, ChatEvents.PRESENCE, {
          user_id: userId,
          is_online: isOnline,
          last_active: isOnline ? null : lastActive,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to broadcast presence: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Current unread total, pushed to a client as soon as it connects. */
  async pushUnreadCount(userId: string): Promise<void> {
    try {
      const { data } = await this.getUnreadCount(userId);
      this.realtime.emitToUser(userId, ChatEvents.UNREAD_COUNT, data);
    } catch {
      // The client also has a REST route for this; a failed push is not worth
      // surfacing on a socket that has only just connected.
    }
  }
}
