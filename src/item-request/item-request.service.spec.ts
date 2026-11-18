import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ItemRequestService } from './item-request.service';
import { LockNamespace } from '../common/advisory-lock';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { ItemEntity, ModerationStatus } from '../item/entities/item.entity';
import { ChatService } from '../chat/chat.service';
import { SystemEvent } from '../chat/entities/message.entity';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { stubPlatformSettings } from '../platform-settings/testing/stub-platform-settings';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { ChatEvents } from '../chat/chat.constants';
import { NotificationService } from '../notification/notification.service';
import {
  numberDefinitionOf,
  type SettingValues,
} from '../platform-settings/settings.registry';

// The shipped values the service falls back to, read from the one place that
// owns them so a changed default cannot leave these tests asserting the old one.
const MAX_PICKUP_ATTEMPTS = numberDefinitionOf(
  'requests.max_pickup_code_attempts',
).default;
const PICKUP_CODE_REQUEST_COOLDOWN_MS =
  numberDefinitionOf('requests.pickup_code_cooldown_minutes').default *
  60 *
  1000;

const buildQueryBuilder = (data: unknown[], total: number) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([data, total]),
});

describe('ItemRequestService', () => {
  let service: ItemRequestService;
  const mockRequestRepo = { createQueryBuilder: jest.fn() };
  const mockRealtime = {
    emitToUser: jest.fn(),
    emitToUsers: jest.fn(),
    foregroundSessions: jest.fn().mockReturnValue([]),
  };
  const mockNotifications = { notify: jest.fn() };

  /** Rebuilds the service, optionally with limits staff have changed. */
  const build = async (settings: Partial<SettingValues> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemRequestService,
        {
          provide: PlatformSettingsService,
          useValue: stubPlatformSettings(settings),
        },
        {
          provide: getRepositoryToken(ItemRequestEntity),
          useValue: mockRequestRepo,
        },
        { provide: getRepositoryToken(ItemEntity), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: ChatService, useValue: {} },
        { provide: ChatRealtimeService, useValue: mockRealtime },
        { provide: NotificationService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get(ItemRequestService);
  };

  beforeEach(() => build());

  afterEach(() => jest.clearAllMocks());

  describe('getUserRequests', () => {
    const pickedUpAt = new Date('2026-09-20T10:00:00.000Z');
    const completed = {
      id: 'req-1',
      item_id: 'item-1',
      requester_id: 'user-1',
      owner_id: 'user-2',
      status: RequestStatus.COMPLETED,
      is_picked_up: true,
      picked_up_at: pickedUpAt,
      created_at: new Date('2026-09-19T10:00:00.000Z'),
      updated_at: new Date('2026-09-21T10:00:00.000Z'),
      item: {
        id: 'item-1',
        user_id: 'user-2',
        title: 'Chair',
        images: [
          { id: 'img-2', display_order: 1, is_primary: false },
          { id: 'img-1', display_order: 0, is_primary: true },
        ],
        user: { id: 'user-2', first_name: 'Ama', last_name: 'Mensah' },
      },
    };

    it('scopes completed collections to the requester with paging metadata', async () => {
      const qb = buildQueryBuilder([completed], 1);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserRequests(
        'user-1',
        2,
        10,
        RequestStatus.COMPLETED,
      );

      expect(qb.where).toHaveBeenCalledWith('request.requester_id = :userId', {
        userId: 'user-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('request.status = :status', {
        status: RequestStatus.COMPLETED,
      });
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
    });

    it('returns active item images in order and the posting user', async () => {
      const qb = buildQueryBuilder([completed], 1);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getUserRequests('user-1');

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'item.images',
        'images',
        'images.is_deleted = :imagesDeleted',
        { imagesDeleted: false },
      );
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('item.user', 'poster');

      const [request] = result.data;
      expect(request.picked_up_at).toEqual(pickedUpAt);
      expect(request.item!.images!.map((image) => image.id)).toEqual([
        'img-1',
        'img-2',
      ]);
      expect(request.item!.user!.name).toBe('Ama Mensah');
    });
  });

  describe('on a deleted item', () => {
    const deletedItem = {
      id: 'item-1',
      user_id: 'owner',
      is_deleted: true,
      status: 'reserved',
    };
    const request = {
      id: 'req-1',
      item_id: 'item-1',
      requester_id: 'a',
      owner_id: 'owner',
      status: RequestStatus.CONFIRMED,
      confirmation_code: 'ABC123',
    };
    let manager: {
      findOne: jest.Mock;
      update: jest.Mock;
      save: jest.Mock;
      query: jest.Mock;
    };

    beforeEach(() => {
      manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(
            entity === ItemEntity ? { ...deletedItem } : { ...request },
          ),
        ),
        update: jest.fn(),
        save: jest.fn((row: object) => Promise.resolve(row)),
        query: jest.fn(),
      };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = {
        createSystemMessage: jest.fn(),
      };
    });

    it('cancelling a confirmed request does not make the item available', async () => {
      await service.cancelRequest('a', 'req-1', {});
      expect(manager.update).not.toHaveBeenCalledWith(
        ItemEntity,
        expect.anything(),
        expect.objectContaining({ status: 'available' }),
      );
    });

    it('refuses a second pickup once the item is no longer reserved', async () => {
      deletedItem.is_deleted = false;
      deletedItem.status = 'picked_up';
      try {
        await expect(
          service.confirmPickup('a', 'req-1', 'ABC123'),
        ).rejects.toThrow('This item is no longer reserved');
        expect(manager.update).not.toHaveBeenCalled();
      } finally {
        deletedItem.is_deleted = true;
        deletedItem.status = 'reserved';
      }
    });

    it('refuses to complete a pickup', async () => {
      await expect(
        service.confirmPickup('a', 'req-1', 'ABC123'),
      ).rejects.toThrow('This item has been removed');
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('createRequest between blocked users', () => {
    it.each([
      ['the owner blocked the requester'],
      ['the requester blocked the owner'],
    ])('is refused when %s', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue({
          id: 'item-1',
          user_id: 'owner',
          is_deleted: false,
          status: 'available',
        }),
        exists: jest.fn().mockResolvedValue(true),
        save: jest.fn(),
      };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      const chatService = { createSystemMessage: jest.fn() };
      (service as unknown as { chatService: object }).chatService = chatService;

      await expect(
        service.createRequest('a', { item_id: 'item-1' }),
      ).rejects.toThrow('You can no longer exchange messages with this user');
      expect(manager.save).not.toHaveBeenCalled();
      expect(chatService.createSystemMessage).not.toHaveBeenCalled();
    });
  });

  describe('on a hidden item', () => {
    const useItem = (manager: object) => {
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: object) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = {
        createSystemMessage: jest.fn(),
      };
    };
    const hiddenItem = {
      id: 'item-1',
      user_id: 'owner',
      is_deleted: false,
      status: 'available',
      moderation_status: ModerationStatus.HIDDEN,
    };

    it('refuses a new request', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue({ ...hiddenItem }),
        exists: jest.fn().mockResolvedValue(false),
        save: jest.fn(),
      };
      useItem(manager);

      await expect(
        service.createRequest('a', { item_id: 'item-1' }),
      ).rejects.toThrow('Item is not available for request');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses confirming a pending request', async () => {
      const manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(
            entity === ItemEntity
              ? { ...hiddenItem }
              : {
                  id: 'req-1',
                  item_id: 'item-1',
                  requester_id: 'a',
                  owner_id: 'owner',
                  status: RequestStatus.PENDING,
                },
          ),
        ),
        update: jest.fn(),
        save: jest.fn(),
        query: jest.fn(),
      };
      useItem(manager);

      await expect(
        service.confirmRequest('owner', 'req-1', {}),
      ).rejects.toThrow(
        'This listing has been hidden by moderators and cannot be confirmed',
      );
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('confirmPickup', () => {
    it('closes the requests still waiting on the item', async () => {
      const waiting = {
        id: 'req-2',
        item_id: 'item-1',
        requester_id: 'b',
        status: RequestStatus.PENDING,
      };
      const manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(
            entity === ItemEntity
              ? { id: 'item-1', is_deleted: false, status: 'reserved' }
              : {
                  id: 'req-1',
                  item_id: 'item-1',
                  requester_id: 'a',
                  owner_id: 'owner',
                  status: RequestStatus.CONFIRMED,
                  confirmation_code: 'ABC123',
                },
          ),
        ),
        find: jest.fn().mockResolvedValue([waiting]),
        update: jest.fn(),
        save: jest.fn((row: object) => Promise.resolve(row)),
        query: jest.fn(),
      };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = {
        createSystemMessage: jest.fn(),
      };

      await service.confirmPickup('a', 'req-1', 'ABC123');

      expect(manager.update).toHaveBeenCalledWith(
        ItemRequestEntity,
        expect.anything(),
        expect.objectContaining({
          status: RequestStatus.CANCELLED,
          cancellation_reason: 'Item was picked up by another requester',
        }),
      );
    });
  });

  describe('pickup code visibility', () => {
    const confirmed = {
      id: 'req-1',
      item_id: 'item-1',
      requester_id: 'requester',
      owner_id: 'owner',
      status: RequestStatus.CONFIRMED,
      confirmation_code: 'ABC234',
      is_picked_up: false,
    };

    it('returns the code to the owner', async () => {
      mockRequestRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([confirmed], 1),
      );

      const result = await service.getItemRequests('owner');

      expect(result.data[0].confirmation_code).toBe('ABC234');
    });

    it('withholds the code from the requester', async () => {
      mockRequestRepo.createQueryBuilder.mockReturnValue(
        buildQueryBuilder([confirmed], 1),
      );

      const result = await service.getUserRequests('requester');

      expect(result.data[0].confirmation_code).toBeNull();
    });

    it('withholds the code from the requester on the detail view', async () => {
      (
        service as unknown as { itemRequestRepository: object }
      ).itemRequestRepository = {
        findOne: jest.fn().mockResolvedValue(confirmed),
      };

      const asRequester = await service.getRequestById('req-1', 'requester');
      const asOwner = await service.getRequestById('req-1', 'owner');

      expect(asRequester.data.confirmation_code).toBeNull();
      expect(asOwner.data.confirmation_code).toBe('ABC234');
    });
  });

  describe('pickup attempt cap', () => {
    const setup = (requestOverrides: object = {}) => {
      const request = {
        id: 'req-1',
        item_id: 'item-1',
        requester_id: 'requester',
        owner_id: 'owner',
        status: RequestStatus.CONFIRMED,
        confirmation_code: 'ABC234',
        pickup_attempts: 0,
        pickup_code_requested_at: null as Date | null,
        ...requestOverrides,
      };
      const manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(
            entity === ItemEntity
              ? { id: 'item-1', is_deleted: false, status: 'reserved' }
              : request,
          ),
        ),
        find: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        save: jest.fn((row: object) => Promise.resolve(row)),
        query: jest.fn(),
      };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = {
        createSystemMessage: jest.fn(),
      };
      return { request, manager };
    };

    it('follows the attempt cap staff have set, not the shipped one', async () => {
      await build({ 'requests.max_pickup_code_attempts': 2 });
      setup({ pickup_attempts: 2 });

      await expect(
        service.confirmPickup('requester', 'req-1', 'WRONG1'),
      ).rejects.toMatchObject({
        status: 429,
        message: 'Too many wrong codes. Ask the owner for a new pickup code',
      });
    });

    it('counts a wrong code and says how many attempts are left', async () => {
      const { request, manager } = setup({ pickup_attempts: 2 });

      await expect(
        service.confirmPickup('requester', 'req-1', 'WRONG1'),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Invalid confirmation code. 2 attempts left',
      });
      expect(request.pickup_attempts).toBe(3);
      expect(manager.save).toHaveBeenCalledWith(request);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('refuses even the right code once the cap is reached', async () => {
      const { manager } = setup({ pickup_attempts: MAX_PICKUP_ATTEMPTS });

      await expect(
        service.confirmPickup('requester', 'req-1', 'ABC234'),
      ).rejects.toMatchObject({ status: 429 });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('accepts the right code on the last allowed attempt', async () => {
      setup({ pickup_attempts: MAX_PICKUP_ATTEMPTS - 1 });

      const result = await service.confirmPickup(
        'requester',
        'req-1',
        'ABC234',
      );

      expect(result.data.status).toBe(RequestStatus.COMPLETED);
    });

    it('lets the owner issue a new code, which resets the attempts', async () => {
      setup({ pickup_attempts: MAX_PICKUP_ATTEMPTS });

      const result = await service.regeneratePickupCode('owner', 'req-1');

      expect(result.data.pickup_locked).toBe(false);
      expect(result.data.confirmation_code).toMatch(/^[A-Z2-9]{6}$/);
      expect(result.data.confirmation_code).not.toBe('ABC234');
    });

    it('clears an earlier ask for a new code when the owner issues one', async () => {
      const { request } = setup({
        pickup_attempts: MAX_PICKUP_ATTEMPTS,
        pickup_code_requested_at: new Date(),
      });

      await service.regeneratePickupCode('owner', 'req-1');

      expect(request.pickup_code_requested_at).toBeNull();
    });

    it('refuses a new code to anyone but the owner', async () => {
      setup();

      await expect(
        service.regeneratePickupCode('requester', 'req-1'),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('requestNewPickupCode', () => {
    const setup = (requestOverrides: object = {}) => {
      const request = {
        id: 'req-1',
        item_id: 'item-1',
        requester_id: 'requester',
        owner_id: 'owner',
        status: RequestStatus.CONFIRMED,
        confirmation_code: 'ABC234',
        pickup_attempts: MAX_PICKUP_ATTEMPTS,
        pickup_code_requested_at: null as Date | null,
        ...requestOverrides,
      };
      const manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(
            entity === ItemEntity
              ? { id: 'item-1', is_deleted: false, status: 'reserved' }
              : request,
          ),
        ),
        save: jest.fn((row: object) => Promise.resolve(row)),
      };
      const chat = { createSystemMessage: jest.fn() };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = chat;
      return { request, chat };
    };

    it('nudges the owner in chat without revealing the code', async () => {
      const { request, chat } = setup();

      const result = await service.requestNewPickupCode('requester', 'req-1');

      expect(request.pickup_code_requested_at).toBeInstanceOf(Date);
      expect(chat.createSystemMessage).toHaveBeenCalledWith({
        actorId: 'requester',
        otherUserId: 'owner',
        event: SystemEvent.PICKUP_CODE_REQUESTED,
        itemId: 'item-1',
        requestId: 'req-1',
      });
      expect(result.data.confirmation_code).toBeNull();
    });

    it('refuses while the requester can still enter a code', async () => {
      const { chat } = setup({ pickup_attempts: MAX_PICKUP_ATTEMPTS - 1 });

      await expect(
        service.requestNewPickupCode('requester', 'req-1'),
      ).rejects.toMatchObject({ status: 400 });
      expect(chat.createSystemMessage).not.toHaveBeenCalled();
    });

    it('refuses a repeat ask within the cooldown', async () => {
      const { chat } = setup({
        pickup_code_requested_at: new Date(Date.now() - 10 * 60 * 1000),
      });

      await expect(
        service.requestNewPickupCode('requester', 'req-1'),
      ).rejects.toMatchObject({
        status: 429,
        message:
          'The owner has already been asked. You can ask again in 50 minutes',
      });
      expect(chat.createSystemMessage).not.toHaveBeenCalled();
    });

    it('allows asking again once the cooldown has passed', async () => {
      const { chat } = setup({
        pickup_code_requested_at: new Date(
          Date.now() - PICKUP_CODE_REQUEST_COOLDOWN_MS - 1000,
        ),
      });

      await service.requestNewPickupCode('requester', 'req-1');

      expect(chat.createSystemMessage).toHaveBeenCalled();
    });

    it('refuses anyone but the requester', async () => {
      setup();

      await expect(
        service.requestNewPickupCode('owner', 'req-1'),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('request caps', () => {
    /**
     * Wires the service to a transaction manager that answers the cap
     * queries. `open` is how many requests the requester already has.
     */
    const setup = (open: number) => {
      const manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(
            entity === ItemEntity
              ? {
                  id: 'item-1',
                  user_id: 'owner',
                  is_deleted: false,
                  status: 'available',
                  moderation_status: ModerationStatus.VISIBLE,
                }
              : null,
          ),
        ),
        exists: jest.fn().mockResolvedValue(false),
        count: jest.fn().mockResolvedValue(open),
        create: jest.fn((_: unknown, row: object) => ({ ...row })),
        save: jest.fn((row: object) => Promise.resolve({ ...row, id: 'r-1' })),
        query: jest.fn().mockResolvedValue([]),
      };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = {
        createSystemMessage: jest.fn().mockResolvedValue(undefined),
      };
      return manager;
    };

    it('refuses a request once the requester is at the open cap', async () => {
      await build({ 'requests.max_active_per_user': 3 });
      setup(3);

      await expect(
        service.createRequest('requester', { item_id: 'item-1' }),
      ).rejects.toThrow('You can have 3 open requests at a time');
    });

    it('allows one more while the requester is under the cap', async () => {
      await build({ 'requests.max_active_per_user': 3 });
      const manager = setup(2);

      await expect(
        service.createRequest('requester', { item_id: 'item-1' }),
      ).resolves.toMatchObject({ state: true });
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [LockNamespace.REQUEST_CAP, 'requester'],
      );
    });

    it('refuses a request once the requester is at the daily cap', async () => {
      await build({ 'requests.max_per_day_per_user': 5 });
      setup(5);

      await expect(
        service.createRequest('requester', { item_id: 'item-1' }),
      ).rejects.toThrow('You can make 5 requests a day');
    });

    it('counts nothing and takes no lock when both caps are off', async () => {
      await build({
        'requests.max_active_per_user': 0,
        'requests.max_per_day_per_user': 0,
      });
      const manager = setup(99);

      await service.createRequest('requester', { item_id: 'item-1' });

      expect(manager.count).not.toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        expect.anything(),
      );
    });
  });

  describe('two-sided pickup', () => {
    const setup = (
      requestOverrides: object = {},
      itemOverrides: object = {},
    ) => {
      const item = {
        id: 'item-1',
        title: 'Chair',
        is_deleted: false,
        status: 'reserved',
        ...itemOverrides,
      };
      const request = {
        id: 'req-1',
        item_id: 'item-1',
        requester_id: 'finder',
        owner_id: 'freer',
        status: RequestStatus.CONFIRMED,
        pickup_marked_by: null as string | null,
        pickup_marked_at: null as Date | null,
        pickup_reminded_at: null as Date | null,
        is_picked_up: false,
        ...requestOverrides,
      };
      const waiting = {
        id: 'req-2',
        item_id: 'item-1',
        requester_id: 'someone-else',
        status: RequestStatus.PENDING,
      };
      const manager = {
        findOne: jest.fn((entity: unknown) =>
          Promise.resolve(entity === ItemEntity ? item : request),
        ),
        find: jest.fn().mockResolvedValue([waiting]),
        update: jest.fn(),
        save: jest.fn((row: object) => Promise.resolve(row)),
        query: jest.fn(),
      };
      const chat = { createSystemMessage: jest.fn() };
      (service as unknown as { dataSource: object }).dataSource = {
        transaction: (work: (m: typeof manager) => unknown) => work(manager),
      };
      (service as unknown as { chatService: object }).chatService = chat;
      return { request, manager, chat };
    };

    const markedBy = (userId: string) => ({
      pickup_marked_by: userId,
      pickup_marked_at: new Date('2026-11-17T10:00:00.000Z'),
    });

    describe('markPickedUp', () => {
      it.each([
        ['the finder', 'finder', 'freer'],
        ['the freer', 'freer', 'finder'],
      ])(
        'lets %s mark it and asks the other party to confirm',
        async (_who, actor, other) => {
          const { request, manager, chat } = setup();

          const result = await service.markPickedUp(actor, 'req-1');

          expect(request.pickup_marked_by).toBe(actor);
          expect(request.pickup_marked_at).toBeInstanceOf(Date);
          expect(result.data.status).toBe(RequestStatus.CONFIRMED);
          expect(result.data.awaiting_pickup_confirmation).toBe(false);
          // Not completed: the item stays reserved until the other side agrees.
          expect(manager.update).not.toHaveBeenCalled();
          expect(chat.createSystemMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              actorId: actor,
              otherUserId: other,
              event: SystemEvent.PICKUP_MARKED,
            }),
          );
          expect(mockRealtime.emitToUser).toHaveBeenCalledWith(
            other,
            ChatEvents.PICKUP_CONFIRMATION_REQUESTED,
            expect.objectContaining({
              request_id: 'req-1',
              item_title: 'Chair',
              marked_by: actor,
            }),
          );
        },
      );

      it('completes the pickup when the other party already marked it', async () => {
        const { request, manager, chat } = setup(markedBy('freer'));

        const result = await service.markPickedUp('finder', 'req-1');

        expect(request.status).toBe(RequestStatus.COMPLETED);
        expect(result.data.is_picked_up).toBe(true);
        expect(manager.update).toHaveBeenCalledWith(
          ItemEntity,
          { id: 'item-1' },
          { status: 'picked_up', picked_by_id: 'finder' },
        );
        expect(chat.createSystemMessage).toHaveBeenCalledWith(
          expect.objectContaining({ event: SystemEvent.PICKUP_CONFIRMED }),
        );
        expect(mockRealtime.emitToUsers).toHaveBeenCalledWith(
          ['freer', 'finder'],
          ChatEvents.PICKUP_CONFIRMATION_RESOLVED,
          { request_id: 'req-1', outcome: 'confirmed' },
        );
      });

      it('raises the sheet again when the marker taps after the cooldown', async () => {
        const { request, chat } = setup({
          pickup_marked_by: 'finder',
          pickup_marked_at: new Date(Date.now() - 6 * 60_000),
        });

        await service.markPickedUp('finder', 'req-1');

        // A re-raise counts as a reminder, so the timed one waits again.
        expect(request.pickup_reminded_at).toBeInstanceOf(Date);
        expect(chat.createSystemMessage).not.toHaveBeenCalled();
        expect(mockRealtime.emitToUser).toHaveBeenCalledWith(
          'freer',
          ChatEvents.PICKUP_CONFIRMATION_REQUESTED,
          expect.anything(),
        );
        // Delivered like a reminder: the push reaches a closed app too.
        expect(mockNotifications.notify).toHaveBeenCalledWith(
          'freer',
          expect.objectContaining({
            title: 'Was it picked up?',
            data: expect.objectContaining({ request_id: 'req-1' }) as unknown,
          }),
          { skipDevicesOf: [] },
        );
      });

      it('ignores a repeat tap within the cooldown', async () => {
        const { manager } = setup({
          pickup_marked_by: 'finder',
          pickup_marked_at: new Date(Date.now() - 5_000),
        });

        const result = await service.markPickedUp('finder', 'req-1');

        expect(result.statusCode).toBe(200);
        expect(manager.save).not.toHaveBeenCalled();
        expect(mockRealtime.emitToUser).not.toHaveBeenCalled();
        expect(mockNotifications.notify).not.toHaveBeenCalled();
      });

      it.each([
        ['4m59s', 4 * 60_000 + 59_000, false],
        ['5m01s', 5 * 60_000 + 1_000, true],
      ])(
        'a tap %s after the last reminder reminds again: %s',
        async (_label, ago, reminds) => {
          setup({
            pickup_marked_by: 'finder',
            pickup_marked_at: new Date(Date.now() - 60 * 60_000),
            pickup_reminded_at: new Date(Date.now() - ago),
          });

          await service.markPickedUp('finder', 'req-1');

          expect(mockNotifications.notify).toHaveBeenCalledTimes(
            reminds ? 1 : 0,
          );
        },
      );

      it('sends no push for a tap minutes after the last reminder', async () => {
        const { manager } = setup({
          pickup_marked_by: 'finder',
          pickup_marked_at: new Date(Date.now() - 60 * 60_000),
          pickup_reminded_at: new Date(Date.now() - 2 * 60_000),
        });

        await service.markPickedUp('finder', 'req-1');

        expect(manager.save).not.toHaveBeenCalled();
        expect(mockRealtime.emitToUser).not.toHaveBeenCalled();
        expect(mockNotifications.notify).not.toHaveBeenCalled();
      });

      it('skips the push on a device that has the app open', async () => {
        setup(markedBy('finder'));
        mockRealtime.foregroundSessions.mockReturnValueOnce(['session-open']);

        await service.markPickedUp('finder', 'req-1');

        expect(mockNotifications.notify).toHaveBeenCalledWith(
          'freer',
          expect.anything(),
          { skipDevicesOf: ['session-open'] },
        );
      });

      it('fails loudly on a mark with no time rather than skip the reminder', async () => {
        setup({ pickup_marked_by: 'finder', pickup_marked_at: null });

        // A 500 to the client; the cause is logged with the request id.
        await expect(
          service.markPickedUp('finder', 'req-1'),
        ).rejects.toMatchObject({ status: 500 });
        expect(mockNotifications.notify).not.toHaveBeenCalled();
        expect(mockRealtime.emitToUser).not.toHaveBeenCalled();
      });

      it('answers a tap after the pickup completed with the finished request', async () => {
        const { manager, chat } = setup(
          { ...markedBy('finder'), status: RequestStatus.COMPLETED },
          { status: 'picked_up' },
        );

        const result = await service.markPickedUp('finder', 'req-1');

        expect(result.data.status).toBe(RequestStatus.COMPLETED);
        expect(manager.save).not.toHaveBeenCalled();
        expect(chat.createSystemMessage).not.toHaveBeenCalled();
      });

      it('refuses anyone outside the request', async () => {
        const { manager } = setup();

        await expect(
          service.markPickedUp('stranger', 'req-1'),
        ).rejects.toMatchObject({ status: 403 });
        expect(manager.save).not.toHaveBeenCalled();
      });

      it('refuses a request that is not confirmed yet', async () => {
        setup({ status: RequestStatus.PENDING }, { status: 'available' });

        await expect(
          service.markPickedUp('finder', 'req-1'),
        ).rejects.toMatchObject({
          status: 400,
          message: 'Request must be confirmed first',
        });
      });

      it('refuses once the item has been removed', async () => {
        setup({}, { is_deleted: true });

        await expect(
          service.markPickedUp('finder', 'req-1'),
        ).rejects.toMatchObject({
          status: 409,
          message: 'This item has been removed',
        });
      });
    });

    describe('confirmPickedUp', () => {
      it('completes the request and closes the others waiting on the item', async () => {
        const { request, manager, chat } = setup(markedBy('finder'));

        const result = await service.confirmPickedUp('freer', 'req-1');

        expect(request.status).toBe(RequestStatus.COMPLETED);
        expect(result.data.is_picked_up).toBe(true);
        expect(result.data.awaiting_pickup_confirmation).toBe(false);
        expect(manager.update).toHaveBeenCalledWith(
          ItemEntity,
          { id: 'item-1' },
          { status: 'picked_up', picked_by_id: 'finder' },
        );
        expect(manager.update).toHaveBeenCalledWith(
          ItemRequestEntity,
          expect.anything(),
          expect.objectContaining({ status: RequestStatus.CANCELLED }),
        );
        expect(chat.createSystemMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: 'freer',
            otherUserId: 'finder',
            event: SystemEvent.PICKUP_CONFIRMED,
          }),
        );
        expect(mockRealtime.emitToUsers).toHaveBeenCalledWith(
          ['freer', 'finder'],
          ChatEvents.PICKUP_CONFIRMATION_RESOLVED,
          { request_id: 'req-1', outcome: 'confirmed' },
        );
      });

      it('answers a retry after it completed without repeating anything', async () => {
        const { manager, chat } = setup(
          { ...markedBy('finder'), status: RequestStatus.COMPLETED },
          { status: 'picked_up' },
        );

        const result = await service.confirmPickedUp('freer', 'req-1');

        expect(result.statusCode).toBe(200);
        expect(result.data.status).toBe(RequestStatus.COMPLETED);
        expect(manager.update).not.toHaveBeenCalled();
        expect(chat.createSystemMessage).not.toHaveBeenCalled();
        expect(mockRealtime.emitToUsers).not.toHaveBeenCalled();
      });

      it('still refuses a completed request to anyone outside it', async () => {
        setup(
          { ...markedBy('finder'), status: RequestStatus.COMPLETED },
          { status: 'picked_up' },
        );

        await expect(
          service.confirmPickedUp('stranger', 'req-1'),
        ).rejects.toMatchObject({ status: 403 });
      });

      it('refuses the party who marked it', async () => {
        const { manager } = setup(markedBy('finder'));

        await expect(
          service.confirmPickedUp('finder', 'req-1'),
        ).rejects.toMatchObject({ status: 400 });
        expect(manager.update).not.toHaveBeenCalled();
      });

      it('refuses when nobody has marked it', async () => {
        setup();

        await expect(
          service.confirmPickedUp('freer', 'req-1'),
        ).rejects.toMatchObject({
          status: 400,
          message: 'Nobody has marked this item as picked up yet',
        });
      });

      it('refuses once the item is no longer reserved', async () => {
        setup(markedBy('finder'), { status: 'available' });

        await expect(
          service.confirmPickedUp('freer', 'req-1'),
        ).rejects.toMatchObject({ status: 409 });
      });
    });

    describe('declinePickedUp', () => {
      it('clears the mark and keeps the item reserved for the request', async () => {
        const { request, manager, chat } = setup({
          ...markedBy('freer'),
          pickup_reminded_at: new Date('2026-11-17T12:00:00.000Z'),
        });

        const result = await service.declinePickedUp('finder', 'req-1');

        expect(request.status).toBe(RequestStatus.CONFIRMED);
        expect(request.pickup_marked_by).toBeNull();
        expect(request.pickup_marked_at).toBeNull();
        expect(request.pickup_reminded_at).toBeNull();
        expect(result.data.awaiting_pickup_confirmation).toBe(false);
        expect(manager.update).not.toHaveBeenCalled();
        expect(chat.createSystemMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: 'finder',
            otherUserId: 'freer',
            event: SystemEvent.PICKUP_DECLINED,
          }),
        );
        expect(mockRealtime.emitToUsers).toHaveBeenCalledWith(
          ['freer', 'finder'],
          ChatEvents.PICKUP_CONFIRMATION_RESOLVED,
          { request_id: 'req-1', outcome: 'declined' },
        );
      });

      it('answers a retried decline without repeating the card', async () => {
        const { manager, chat } = setup();

        const result = await service.declinePickedUp('finder', 'req-1');

        expect(result.statusCode).toBe(200);
        expect(result.data.status).toBe(RequestStatus.CONFIRMED);
        expect(manager.save).not.toHaveBeenCalled();
        expect(chat.createSystemMessage).not.toHaveBeenCalled();
        expect(mockRealtime.emitToUsers).not.toHaveBeenCalled();
      });

      it('lets either side mark it again after a decline', async () => {
        const { request } = setup(markedBy('freer'));
        await service.declinePickedUp('finder', 'req-1');

        await service.markPickedUp('freer', 'req-1');

        expect(request.pickup_marked_by).toBe('freer');
      });

      it('refuses the party who marked it', async () => {
        setup(markedBy('freer'));

        await expect(
          service.declinePickedUp('freer', 'req-1'),
        ).rejects.toMatchObject({ status: 400 });
      });
    });

    it('sends no pickup event when completing by code with nothing marked', async () => {
      setup({ confirmation_code: 'ABC234', pickup_attempts: 0 });

      await service.confirmPickup('finder', 'req-1', 'ABC234');

      expect(mockRealtime.emitToUsers).not.toHaveBeenCalled();
    });

    it('closes a pending sheet when the pickup completes by code', async () => {
      setup({
        ...markedBy('freer'),
        confirmation_code: 'ABC234',
        pickup_attempts: 0,
      });

      await service.confirmPickup('finder', 'req-1', 'ABC234');

      expect(mockRealtime.emitToUsers).toHaveBeenCalledWith(
        ['freer', 'finder'],
        ChatEvents.PICKUP_CONFIRMATION_RESOLVED,
        { request_id: 'req-1', outcome: 'confirmed' },
      );
    });

    it("closes the other phone's sheet when a marked request is cancelled", async () => {
      const { request } = setup(markedBy('finder'));

      await service.cancelRequest('freer', 'req-1', {});

      expect(request.pickup_marked_by).toBeNull();
      expect(mockRealtime.emitToUsers).toHaveBeenCalledWith(
        ['freer', 'finder'],
        ChatEvents.PICKUP_CONFIRMATION_RESOLVED,
        { request_id: 'req-1', outcome: 'cancelled' },
      );
    });

    it('sends no pickup event when a cancelled request had no mark', async () => {
      setup();

      await service.cancelRequest('freer', 'req-1', {});

      expect(mockRealtime.emitToUsers).not.toHaveBeenCalled();
    });

    it('flags the pending confirmation for the waiting party only', async () => {
      const marked = {
        id: 'req-1',
        item_id: 'item-1',
        requester_id: 'finder',
        owner_id: 'freer',
        status: RequestStatus.CONFIRMED,
        is_picked_up: false,
        ...markedBy('finder'),
      };
      (
        service as unknown as { itemRequestRepository: object }
      ).itemRequestRepository = {
        findOne: jest.fn().mockResolvedValue(marked),
      };

      const asFreer = await service.getRequestById('req-1', 'freer');
      const asFinder = await service.getRequestById('req-1', 'finder');

      expect(asFreer.data.awaiting_pickup_confirmation).toBe(true);
      expect(asFinder.data.awaiting_pickup_confirmation).toBe(false);
      expect(asFinder.data.pickup_marked_by).toBe('finder');
    });
  });

  describe('getPendingPickupConfirmations', () => {
    it('lists only confirmed requests the other party marked', async () => {
      const qb = buildQueryBuilder([], 0);
      mockRequestRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getPendingPickupConfirmations(
        'freer',
        1,
        20,
      );

      expect(qb.where).toHaveBeenCalledWith('request.status = :status', {
        status: RequestStatus.CONFIRMED,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'request.pickup_marked_by <> :userId',
        { userId: 'freer' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(request.owner_id = :userId OR request.requester_id = :userId)',
        { userId: 'freer' },
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith('request.id', 'ASC');
      expect(result).toMatchObject({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('sendPickupConfirmationReminders', () => {
    const row = {
      id: 'req-1',
      item_id: 'item-1',
      owner_id: 'freer',
      requester_id: 'finder',
      status: RequestStatus.CONFIRMED,
      pickup_marked_by: 'finder',
      pickup_marked_at: new Date('2026-11-17T10:00:00.000Z'),
      item_title: 'Chair',
    };
    let query: jest.Mock;

    beforeEach(() => {
      query = jest.fn().mockResolvedValue([[row], 1]);
      (service as unknown as { dataSource: object }).dataSource = { query };
    });

    it('pushes the waiting party and raises their sheet again', async () => {
      mockRealtime.foregroundSessions.mockReturnValueOnce(['session-open']);

      const sent = await service.sendPickupConfirmationReminders();

      expect(sent).toBe(1);
      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'freer',
        expect.objectContaining({
          title: 'Was it picked up?',
          data: {
            type: 'pickup_confirmation',
            request_id: 'req-1',
            item_id: 'item-1',
          },
        }),
        { skipDevicesOf: ['session-open'] },
      );
      expect(mockRealtime.emitToUser).toHaveBeenCalledWith(
        'freer',
        ChatEvents.PICKUP_CONFIRMATION_REQUESTED,
        expect.objectContaining({ request_id: 'req-1', marked_by: 'finder' }),
      );
    });

    it('claims rows using the interval staff have set', async () => {
      await build({ 'requests.pickup_reminder_minutes': 45 });
      (service as unknown as { dataSource: object }).dataSource = { query };

      await service.sendPickupConfirmationReminders();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        [RequestStatus.CONFIRMED, 45, expect.any(Number)],
      );
    });

    it('sends nothing when no confirmation is due', async () => {
      query.mockResolvedValue([[], 0]);

      const sent = await service.sendPickupConfirmationReminders();

      expect(sent).toBe(0);
      expect(mockNotifications.notify).not.toHaveBeenCalled();
    });
  });
});
