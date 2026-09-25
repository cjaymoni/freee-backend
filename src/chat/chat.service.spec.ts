import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ChatService } from './chat.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { ConversationEntity } from './entities/conversation.entity';
import {
  MessageEntity,
  MessageType,
  SystemEvent,
} from './entities/message.entity';
import { UserEntity } from '../user/entities/user.entity';
import { ItemEntity } from '../item/entities/item.entity';
import { ItemRequestEntity } from '../item-request/entities/item-request.entity';
import { BlockedUser } from '../moderation/entities/blocked-user.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FirebaseService } from '../firebase/firebase.service';
import { AppError } from '../common/app-error';

// Chosen so that ALICE < BOB lexicographically, which is what the canonical
// pair ordering is keyed on.
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';

const conversation = (overrides: Partial<ConversationEntity> = {}) =>
  ({
    id: 'conv-1',
    user_a_id: ALICE,
    user_b_id: BOB,
    item_id: null,
    last_message_at: null,
    last_message_preview: null,
    last_message_sender_id: null,
    user_a_unread_count: 0,
    user_b_unread_count: 0,
    user_a_last_read_at: null,
    user_b_last_read_at: null,
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    updated_at: new Date('2026-09-01T00:00:00.000Z'),
    userA: { id: ALICE, first_name: 'Alice', last_name: 'A' },
    userB: { id: BOB, first_name: 'Bob', last_name: 'B' },
    ...overrides,
  }) as ConversationEntity;

const message = (overrides: Partial<MessageEntity> = {}) =>
  ({
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: ALICE,
    recipient_id: BOB,
    message_type: MessageType.TEXT,
    content: 'hello',
    system_event: null,
    metadata: null,
    image_url: null,
    image_public_id: null,
    image_width: null,
    image_height: null,
    read_at: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date('2026-09-02T00:00:00.000Z'),
    updated_at: new Date('2026-09-02T00:00:00.000Z'),
    ...overrides,
  }) as MessageEntity;

/** Records what an UPDATE would have set, so the tests can assert on it. */
const recordingUpdateBuilder = (sink: Record<string, unknown>[]) => ({
  update: jest.fn().mockReturnThis(),
  set: jest.fn(function (this: unknown, values: Record<string, unknown>) {
    sink.push(values);
    return this;
  }),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  returning: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ raw: [] }),
});

describe('ChatService', () => {
  let service: ChatService;
  let realtime: ChatRealtimeService;
  let conversationRepository: any;
  let messageRepository: any;
  let userRepository: any;
  let itemRepository: any;
  let itemRequestRepository: any;
  let blockedUserRepository: any;
  let dataSource: any;
  /** Every `set()` payload written during a test. */
  let updates: Record<string, unknown>[];

  beforeEach(async () => {
    updates = [];

    conversationRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve({ id: 'conv-1', ...value })),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => recordingUpdateBuilder(updates)),
    };

    messageRepository = {
      findOne: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => recordingUpdateBuilder(updates)),
    };

    userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: BOB, is_deleted: false }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    itemRepository = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    itemRequestRepository = { find: jest.fn().mockResolvedValue([]) };
    blockedUserRepository = { findOne: jest.fn().mockResolvedValue(null) };

    dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => unknown) =>
        callback({
          create: jest.fn((_entity, value) => value),
          save: jest.fn((value) =>
            Promise.resolve({
              id: 'msg-new',
              created_at: new Date('2026-09-03T00:00:00.000Z'),
              ...value,
            }),
          ),
          update: jest.fn().mockResolvedValue(undefined),
          createQueryBuilder: jest.fn(() => recordingUpdateBuilder(updates)),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        ChatRealtimeService,
        {
          provide: getRepositoryToken(ConversationEntity),
          useValue: conversationRepository,
        },
        {
          provide: getRepositoryToken(MessageEntity),
          useValue: messageRepository,
        },
        { provide: getRepositoryToken(UserEntity), useValue: userRepository },
        { provide: getRepositoryToken(ItemEntity), useValue: itemRepository },
        {
          provide: getRepositoryToken(ItemRequestEntity),
          useValue: itemRequestRepository,
        },
        {
          provide: getRepositoryToken(BlockedUser),
          useValue: blockedUserRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: CloudinaryService, useValue: { uploadImage: jest.fn(), deleteImage: jest.fn() } },
        { provide: FirebaseService, useValue: { sendNotification: jest.fn() } },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    realtime = module.get<ChatRealtimeService>(ChatRealtimeService);
  });

  const statusOf = (error: unknown): number =>
    (error as AppError).getStatus();

  describe('listConversations', () => {
    const listBuilder = (rows: ConversationEntity[]) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([rows, rows.length]),
    });

    it('orders by last activity through a plain alias, then by ID', async () => {
      const builder = listBuilder([]);
      conversationRepository.createQueryBuilder.mockReturnValue(builder);

      await service.listConversations(ALICE, { page: 1, limit: 20 });

      // Messages sort by last_message_at, empty threads by created_at.
      expect(builder.addSelect).toHaveBeenCalledWith(
        'COALESCE(conversation.last_message_at, conversation.created_at)',
        'activity_at',
      );
      // Ordering by the raw expression makes TypeORM treat it as a relation
      // path under skip/take, so it must go through the alias.
      expect(builder.orderBy).toHaveBeenCalledWith('activity_at', 'DESC');
      expect(builder.addOrderBy).toHaveBeenCalledWith(
        'conversation.id',
        'DESC',
      );
    });

    it('returns the paged envelope in database order', async () => {
      const builder = listBuilder([
        conversation({ id: 'conv-2', last_message_at: new Date('2026-09-05') }),
        conversation({ id: 'conv-1' }),
      ]);
      conversationRepository.createQueryBuilder.mockReturnValue(builder);

      const result = await service.listConversations(ALICE, {
        page: 2,
        limit: 10,
      });

      expect(builder.skip).toHaveBeenCalledWith(10);
      expect(result.data.map((dto) => dto.id)).toEqual(['conv-2', 'conv-1']);
      expect(result).toMatchObject({ total: 2, page: 2, limit: 10 });
    });

    it('applies the search filter without breaking the query', async () => {
      const builder = listBuilder([]);
      conversationRepository.createQueryBuilder.mockReturnValue(builder);

      const result = await service.listConversations(ALICE, {
        page: 1,
        limit: 20,
        search: 'bob',
      });

      expect(builder.andWhere).toHaveBeenCalled();
      expect(result.state).toBe(true);
    });

    it('hides database details when the query fails', async () => {
      const builder = listBuilder([]);
      builder.getManyAndCount.mockRejectedValue(
        new Error(
          '"COALESCE(conversation" alias was not found. Maybe you forgot to join it?',
        ),
      );
      conversationRepository.createQueryBuilder.mockReturnValue(builder);

      const error = await service
        .listConversations(ALICE, { page: 1, limit: 20 })
        .catch((e: AppError) => e);

      expect(statusOf(error)).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = JSON.stringify((error as AppError).getResponse());
      expect(body).toContain('Could not load conversations');
      expect(body).not.toContain('alias');
      expect(body).not.toContain('COALESCE');
    });
  });

  describe('canonical pair ordering', () => {
    it('stores a new conversation with the smaller user id first, whichever way round it is opened', async () => {
      conversationRepository.findOne
        .mockResolvedValueOnce(null) // resolveConversation lookup
        .mockResolvedValue(conversation()); // loadConversationForViewer

      // Bob opens the chat with Alice, so the arguments arrive reversed.
      await service.getOrCreateConversation(BOB, { recipient_id: ALICE });

      expect(conversationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ user_a_id: ALICE, user_b_id: BOB }),
      );
    });

    it('reuses the existing thread rather than opening a second one', async () => {
      conversationRepository.findOne.mockResolvedValue(conversation());

      await service.getOrCreateConversation(ALICE, { recipient_id: BOB });

      expect(conversationRepository.save).not.toHaveBeenCalled();
    });

    it('refuses a conversation with yourself', async () => {
      try {
        await service.getOrCreateConversation(ALICE, { recipient_id: ALICE });
        fail('expected a rejection');
      } catch (error) {
        expect(statusOf(error)).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('blocking', () => {
    it('refuses to open a conversation when either side has blocked the other', async () => {
      blockedUserRepository.findOne.mockResolvedValue({ id: 'block-1' });

      try {
        await service.getOrCreateConversation(ALICE, { recipient_id: BOB });
        fail('expected a rejection');
      } catch (error) {
        expect(statusOf(error)).toBe(HttpStatus.FORBIDDEN);
      }
    });

    it('refuses to send when either side has blocked the other', async () => {
      conversationRepository.findOne.mockResolvedValue(conversation());
      blockedUserRepository.findOne.mockResolvedValue({ id: 'block-1' });

      try {
        await service.sendMessage(ALICE, 'conv-1', 'hello');
        fail('expected a rejection');
      } catch (error) {
        expect(statusOf(error)).toBe(HttpStatus.FORBIDDEN);
      }
    });
  });

  describe('access control', () => {
    it("hides someone else's conversation behind a 404 rather than a 403", async () => {
      conversationRepository.findOne.mockResolvedValue(conversation());

      try {
        await service.getMessages('conv-1', CAROL, {});
        fail('expected a rejection');
      } catch (error) {
        // A 403 would confirm to a stranger that the thread exists.
        expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  describe('unread counters', () => {
    it("increments the recipient's column, not the sender's", async () => {
      conversationRepository.findOne.mockResolvedValue(conversation());

      // Alice is side A, so Bob's counter (side B) is the one to move.
      await service.sendMessage(ALICE, 'conv-1', 'hello');

      const increment = updates.find((set) => 'user_b_unread_count' in set);
      expect(increment).toBeDefined();
      expect(updates.some((set) => 'user_a_unread_count' in set)).toBe(false);
    });

    it("zeroes the reader's column on mark-as-read", async () => {
      conversationRepository.findOne.mockResolvedValue(conversation());

      // Bob reads, so side B's counter resets and side B's timestamp moves.
      await service.markAsRead('conv-1', BOB);

      const reset = updates.find((set) => 'user_b_unread_count' in set);
      expect(reset?.user_b_unread_count).toBe(0);
      expect(reset?.user_b_last_read_at).toBeInstanceOf(Date);
    });
  });

  describe('message serialisation', () => {
    const toDto = (entity: MessageEntity, viewerId: string) =>
      (service as any).toMessageDto(entity, viewerId);

    it('strips the body of a deleted message', () => {
      const dto = toDto(
        message({
          is_deleted: true,
          content: 'secret',
          image_url: 'https://example.com/a.jpg',
        }),
        ALICE,
      );

      expect(dto.is_deleted).toBe(true);
      expect(dto.content).toBeNull();
      expect(dto.image_url).toBeNull();
    });

    it('renders one system row from both sides, so each party sees their own perspective', () => {
      const systemMessage = message({
        message_type: MessageType.SYSTEM,
        system_event: SystemEvent.ITEM_REQUESTED,
        content: null,
        metadata: { item_id: 'item-1', item_title: 'Red USB cable' },
        sender_id: ALICE,
        recipient_id: BOB,
      });

      // Alice requested the item, so it is her action...
      expect(toDto(systemMessage, ALICE).is_mine).toBe(true);
      // ...and Bob sees the same row as something done to his item.
      expect(toDto(systemMessage, BOB).is_mine).toBe(false);
    });

    it('marks a message read once read_at is stamped', () => {
      expect(toDto(message({ read_at: null }), BOB).is_read).toBe(false);
      expect(toDto(message({ read_at: new Date() }), BOB).is_read).toBe(true);
    });
  });

  describe('presence', () => {
    it('reports a user online only while they hold at least one socket', () => {
      expect(realtime.isOnline(ALICE)).toBe(false);

      expect(realtime.registerSocket(ALICE, 'socket-1')).toBe(true);
      // A second device must not re-announce them as newly online.
      expect(realtime.registerSocket(ALICE, 'socket-2')).toBe(false);
      expect(realtime.isOnline(ALICE)).toBe(true);

      // Closing one of two sockets leaves them online.
      expect(realtime.unregisterSocket(ALICE, 'socket-1')).toBe(false);
      expect(realtime.isOnline(ALICE)).toBe(true);

      expect(realtime.unregisterSocket(ALICE, 'socket-2')).toBe(true);
      expect(realtime.isOnline(ALICE)).toBe(false);
    });
  });

  describe('system messages', () => {
    it('never throws, so a chat failure cannot roll back a committed request', async () => {
      conversationRepository.findOne.mockRejectedValue(
        new Error('database is down'),
      );

      await expect(
        service.createSystemMessage({
          actorId: ALICE,
          otherUserId: BOB,
          event: SystemEvent.PICKUP_CONFIRMED,
          itemId: 'item-1',
          requestId: 'req-1',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
