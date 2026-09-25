import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ItemRequestService } from './item-request.service';
import {
  ItemRequestEntity,
  RequestStatus,
} from './entities/item-request.entity';
import { ItemEntity } from '../item/entities/item.entity';
import { ChatService } from '../chat/chat.service';

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
});
