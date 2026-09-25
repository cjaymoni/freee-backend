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
});
