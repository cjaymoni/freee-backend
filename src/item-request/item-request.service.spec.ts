import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ItemRequestService,
  MAX_PICKUP_ATTEMPTS,
  PICKUP_CODE_REQUEST_COOLDOWN_MS,
} from './item-request.service';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { ItemEntity, ModerationStatus } from '../item/entities/item.entity';
import { ChatService } from '../chat/chat.service';
import { SystemEvent } from '../chat/entities/message.entity';

const buildQueryBuilder = (data: unknown[], total: number) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([data, total]),
});

describe('ItemRequestService', () => {
  let service: ItemRequestService;
  const mockRequestRepo = { createQueryBuilder: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemRequestService,
        {
          provide: getRepositoryToken(ItemRequestEntity),
          useValue: mockRequestRepo,
        },
        { provide: getRepositoryToken(ItemEntity), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: ChatService, useValue: {} },
      ],
    }).compile();

    service = module.get(ItemRequestService);
  });

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
});
