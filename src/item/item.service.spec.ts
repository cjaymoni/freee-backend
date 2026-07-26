import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ItemService } from './item.service';
import { ItemEntity, ItemCondition, ItemStatus } from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { ItemResponseDto } from './dto/item-response.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DistanceService } from '../common/distance.service';
import { UserEntity } from '../user/entities/user.entity';
import { SavedItemEntity } from '../saved-item/entities/saved-item.entity';
import { ItemViewService } from '../item-view/item-view.service';

const mockUser: UserEntity & { items_count?: number } = {
  id: 'user-1',
  first_name: 'John',
  last_name: 'Doe',
  cloudinary_avatar_url: 'https://res.cloudinary.com/example/avatar.jpg',
  member_since: new Date('2024-01-01T00:00:00.000Z'),
  phone_number: '+233243225121',
  items_count: 3,
} as any;

const mockLocation = (lat: number, lng: number) => ({ latitude: lat, longitude: lng } as any);

const mockItemEntity: ItemEntity = {
  id: 'item-1',
  user_id: 'user-1',
  title: 'Test Item',
  description: 'A test item',
  category_id: null,
  condition: ItemCondition.GOOD,
  status: ItemStatus.AVAILABLE,
  price: 0,
  is_free: true,
  quantity: 2,
  view_count: 0,
  location_id: 'loc-1',
  location: mockLocation(5.6037, -0.1870),  // Accra
  pickup_date: null,
  pickup_time: null,
  pickup_type: null,
  is_featured: false,
  featured_until: null,
  is_deleted: false,
  deleted_at: null,
  deleted_by: null,
  deletion_reason: null,
  created_at: new Date('2026-06-28T16:28:43.399Z'),
  updated_at: new Date('2026-06-28T16:28:43.399Z'),
  images: [],
  user: mockUser,
  category: null,
  deletedByUser: null,
} as any;

const buildQueryBuilder = (entities: ItemEntity[], raw: object[]) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getRawAndEntities: jest.fn().mockResolvedValue({ entities, raw }),
});

describe('ItemResponseDto.fromEntity', () => {
  it('maps user fields correctly', () => {
    const dto = ItemResponseDto.fromEntity(mockItemEntity);

    expect(dto.user).toBeDefined();
    expect(dto.user!.id).toBe('user-1');
    expect(dto.user!.name).toBe('John Doe');
    expect(dto.user!.profile_image).toBe('https://res.cloudinary.com/example/avatar.jpg');
    expect(dto.user!.joined_date).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    expect(dto.user!.phone_number).toBe('+233243225121');
    expect(dto.user!.items_count).toBe(3);
  });

  it('returns empty name when first_name and last_name are absent', () => {
    const entity = { ...mockItemEntity, user: { ...mockUser, first_name: null, last_name: null } } as any;
    const dto = ItemResponseDto.fromEntity(entity);
    expect(dto.user!.name).toBe('');
  });

  it('sets user to undefined when user relation is not loaded', () => {
    const entity = { ...mockItemEntity, user: undefined } as any;
    const dto = ItemResponseDto.fromEntity(entity);
    expect(dto.user).toBeUndefined();
  });

  it('returns quantity as a number', () => {
    const dto = ItemResponseDto.fromEntity(mockItemEntity);
    expect(typeof dto.quantity).toBe('number');
    expect(dto.quantity).toBe(2);
  });

  it('defaults items_count to 0 when not set on user', () => {
    const entity = { ...mockItemEntity, user: { ...mockUser, items_count: undefined } } as any;
    const dto = ItemResponseDto.fromEntity(entity);
    expect(dto.user!.items_count).toBe(0);
  });
});

describe('CreateItemDto quantity parsing', () => {
  it('parses quantity from string "3" to number 3', async () => {
    const dto = plainToInstance(CreateItemDto, {
      title: 'Test',
      condition: ItemCondition.GOOD,
      quantity: '3',
    });
    const errors = await validate(dto);
    const quantityError = errors.find((e) => e.property === 'quantity');
    expect(quantityError).toBeUndefined();
    expect(dto.quantity).toBe(3);
  });

  it('rejects quantity below minimum of 1', async () => {
    const dto = plainToInstance(CreateItemDto, {
      title: 'Test',
      condition: ItemCondition.GOOD,
      quantity: '0',
    });
    const errors = await validate(dto);
    const quantityError = errors.find((e) => e.property === 'quantity');
    expect(quantityError).toBeDefined();
  });
});

describe('ItemService', () => {
  let service: ItemService;
  let mockQueryBuilder: ReturnType<typeof buildQueryBuilder>;

  const mockItemRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockItemViewService = {
    recordUniqueView: jest
      .fn()
      .mockResolvedValue({ isNew: true, view: { id: 'view-1' } }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemService,
        { provide: getRepositoryToken(ItemEntity), useValue: mockItemRepo },
        { provide: getRepositoryToken(ItemImageEntity), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(SavedItemEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: CloudinaryService, useValue: { uploadImage: jest.fn() } },
        DistanceService,
        { provide: ItemViewService, useValue: mockItemViewService },
      ],
    }).compile();

    service = module.get<ItemService>(ItemService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findOne', () => {
    it('returns item with user object and items_count from subquery', async () => {
      mockQueryBuilder = buildQueryBuilder(
        [mockItemEntity],
        [{ user_items_count: '3' }],
      );
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      mockItemRepo.update.mockResolvedValue(undefined);

      const result = await service.findOne('item-1');

      expect(result.state).toBe(true);
      expect(result.data.user).toBeDefined();
      expect(result.data.user!.id).toBe('user-1');
      expect(result.data.user!.name).toBe('John Doe');
      expect(result.data.user!.items_count).toBe(3);
      expect(result.data.user!.phone_number).toBe('+233243225121');
    });

    it('throws NotFoundException when item does not exist', async () => {
      mockQueryBuilder = buildQueryBuilder([], []);
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('records a deduplicated view for the requesting viewer', async () => {
      mockQueryBuilder = buildQueryBuilder([mockItemEntity], [{ user_items_count: '1' }]);
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.findOne('item-1', 'user-2', '10.0.0.1');

      expect(mockItemViewService.recordUniqueView).toHaveBeenCalledWith({
        itemId: 'item-1',
        viewerId: 'user-2',
        ipAddress: '10.0.0.1',
      });
      // view_count is owned by item_views aggregation, never blind-incremented
      expect(mockItemRepo.update).not.toHaveBeenCalled();
    });

    it('reflects the new view in the returned view_count on a first view', async () => {
      mockQueryBuilder = buildQueryBuilder(
        [{ ...mockItemEntity, view_count: 7 }],
        [{ user_items_count: '1' }],
      );
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      mockItemViewService.recordUniqueView.mockResolvedValueOnce({
        isNew: true,
        view: { id: 'view-1' },
      });

      const result = await service.findOne('item-1', 'user-2', '10.0.0.1');

      expect(result.data.view_count).toBe(8);
    });

    it('does not inflate view_count when the viewer has already viewed the item', async () => {
      mockQueryBuilder = buildQueryBuilder(
        [{ ...mockItemEntity, view_count: 7 }],
        [{ user_items_count: '1' }],
      );
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      mockItemViewService.recordUniqueView.mockResolvedValueOnce({
        isNew: false,
        view: { id: 'view-1' },
      });

      const result = await service.findOne('item-1', 'user-2', '10.0.0.1');

      expect(result.data.view_count).toBe(7);
      expect(mockItemRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns items with user object and items_count from subquery', async () => {
      mockQueryBuilder = buildQueryBuilder(
        [mockItemEntity],
        [{ user_items_count: '5' }],
      );
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAll();

      expect(result.state).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].user).toBeDefined();
      expect(result.data[0].user!.items_count).toBe(5);
    });

    it('returns empty array when no items exist', async () => {
      mockQueryBuilder = buildQueryBuilder([], []);
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAll();

      expect(result.data).toHaveLength(0);
    });

    it('does not set user when user relation is not loaded', async () => {
      const entityWithoutUser = { ...mockItemEntity, user: undefined } as any;
      mockQueryBuilder = buildQueryBuilder([entityWithoutUser], [{ user_items_count: '0' }]);
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAll();

      expect(result.data[0].user).toBeUndefined();
    });

    describe('proximity filtering', () => {
      // Item in Accra (5.6037, -0.1870)
      // Item in Kumasi (6.6885, -1.6244) — ~250km from Accra
      const accraItem = { ...mockItemEntity, id: 'item-accra', location: mockLocation(5.6037, -0.1870) } as any;
      const kumasiItem = { ...mockItemEntity, id: 'item-kumasi', location: mockLocation(6.6885, -1.6244) } as any;
      const noLocationItem = { ...mockItemEntity, id: 'item-noloc', location: null } as any;

      beforeEach(() => {
        mockQueryBuilder = buildQueryBuilder(
          [accraItem, kumasiItem, noLocationItem],
          [{ user_items_count: '1' }, { user_items_count: '2' }, { user_items_count: '0' }],
        );
        mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      });

      it('returns all items when no lat/lng provided', async () => {
        const result = await service.findAll();
        expect(result.data).toHaveLength(3);
      });

      it('filters to nearby items within default 10km radius', async () => {
        // Searching from Accra — only accraItem should be within 10km
        const result = await service.findAll({ lat: 5.6037, lng: -0.1870 });
        const ids = result.data.map((d) => d.id);
        expect(ids).toContain('item-accra');
        expect(ids).not.toContain('item-kumasi');
      });

      it('includes items without a location regardless of radius', async () => {
        const result = await service.findAll({ lat: 5.6037, lng: -0.1870 });
        const ids = result.data.map((d) => d.id);
        expect(ids).toContain('item-noloc');
      });

      it('includes distant items when radius is large enough', async () => {
        // 300km radius from Accra should include Kumasi (~250km away)
        const result = await service.findAll({ lat: 5.6037, lng: -0.1870, radius: 300 });
        const ids = result.data.map((d) => d.id);
        expect(ids).toContain('item-accra');
        expect(ids).toContain('item-kumasi');
      });

      it('excludes distant items when radius is small', async () => {
        const result = await service.findAll({ lat: 5.6037, lng: -0.1870, radius: 5 });
        const ids = result.data.map((d) => d.id);
        expect(ids).not.toContain('item-kumasi');
      });
    });
  });
});
