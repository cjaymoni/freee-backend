import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ItemService } from './item.service';
import {
  ItemEntity,
  ItemCondition,
  ItemStatus,
  PickupType,
} from './entities/item.entity';
import { ItemImageEntity } from './entities/item-image.entity';
import { ItemResponseDto } from './dto/item-response.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { DistanceService } from '../common/distance.service';
import { UserEntity } from '../user/entities/user.entity';
import { SavedItemEntity } from '../saved-item/entities/saved-item.entity';
import { LocationEntity } from '../user/entities/location.entity';
import { ItemViewService } from '../item-view/item-view.service';
import { SearchService } from '../search/search.service';

const mockUser: UserEntity & { items_count?: number } = {
  id: 'user-1',
  first_name: 'John',
  last_name: 'Doe',
  cloudinary_avatar_url: 'https://res.cloudinary.com/example/avatar.jpg',
  member_since: new Date('2024-01-01T00:00:00.000Z'),
  phone_number: '+233243225121',
  items_count: 3,
} as any;

const mockLocation = (lat: number, lng: number) =>
  ({ latitude: lat, longitude: lng }) as any;

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
  location: mockLocation(5.6037, -0.187), // Accra
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

const mockImage = (
  id: string,
  order: number,
  primary: boolean,
): ItemImageEntity =>
  ({
    id,
    item_id: 'item-1',
    cloudinary_public_id: `public-${id}`,
    cloudinary_url: `https://res.cloudinary.com/${id}.jpg`,
    cloudinary_secure_url: `https://res.cloudinary.com/${id}.jpg`,
    cloudinary_format: 'jpg',
    width: 100,
    height: 100,
    size_bytes: 1234,
    display_order: order,
    is_primary: primary,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date('2026-06-28T16:28:43.399Z'),
  }) as ItemImageEntity;

const mockFile = (name: string): Express.Multer.File =>
  ({ originalname: name, buffer: Buffer.from('x') }) as Express.Multer.File;

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
    expect(dto.user!.profile_image).toBe(
      'https://res.cloudinary.com/example/avatar.jpg',
    );
    expect(dto.user!.joined_date).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    expect(dto.user!.phone_number).toBe('+233243225121');
    expect(dto.user!.items_count).toBe(3);
  });

  it('returns empty name when first_name and last_name are absent', () => {
    const entity = {
      ...mockItemEntity,
      user: { ...mockUser, first_name: null, last_name: null },
    } as any;
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
    const entity = {
      ...mockItemEntity,
      user: { ...mockUser, items_count: undefined },
    } as any;
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

  const quantityErrorFor = async (quantity: unknown) => {
    const dto = plainToInstance(CreateItemDto, {
      title: 'Test',
      condition: ItemCondition.GOOD,
      quantity,
    });
    const errors = await validate(dto);
    return {
      dto,
      error: errors.find((e) => e.property === 'quantity'),
    };
  };

  it.each([
    ['an empty string', ''],
    ['null', null],
  ])('treats %s as unset so the column default applies', async (_label, q) => {
    const { dto, error } = await quantityErrorFor(q);

    expect(error).toBeUndefined();
    expect(dto.quantity).toBeUndefined();
  });

  it('rejects a fractional quantity', async () => {
    const { error } = await quantityErrorFor('2.5');

    expect(error?.constraints).toHaveProperty('isInt');
  });

  it('rejects a quantity that is not a number at all', async () => {
    const { error } = await quantityErrorFor('abc');

    expect(error?.constraints).toHaveProperty('isInt');
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

  const mockImageRepo = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((data: Partial<ItemImageEntity>) => ({ ...data })),
    save: jest.fn((entity: unknown) => Promise.resolve(entity)),
  };

  const mockLocationRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: Partial<LocationEntity>) => ({ ...data })),
    save: jest.fn((entity: Partial<LocationEntity>) =>
      Promise.resolve({ id: entity.id ?? 'new-loc', ...entity }),
    ),
  };

  const mockCloudinary = {
    uploadImage: jest.fn((file: Express.Multer.File) =>
      file.originalname.startsWith('fail')
        ? Promise.reject(new Error('Cloudinary is down'))
        : Promise.resolve({
            publicId: `public-${file.originalname}`,
            secureUrl: `https://res.cloudinary.com/${file.originalname}`,
            format: 'jpg',
            width: 100,
            height: 100,
            bytes: 1234,
          }),
    ),
    deleteImage: jest.fn().mockResolvedValue({ result: 'ok' }),
    deleteImagesQuietly: jest.fn().mockResolvedValue(undefined),
  };

  // Runs the work against the same mocked repositories, so tests see what the
  // transaction wrote.
  const mockDataSource = {
    transaction: jest.fn((work: (manager: unknown) => Promise<unknown>) =>
      work({
        getRepository: (entity: unknown) =>
          entity === ItemEntity ? mockItemRepo : mockImageRepo,
      }),
    ),
  };

  const mockSearchService = { record: jest.fn().mockResolvedValue(undefined) };

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
        {
          provide: getRepositoryToken(ItemImageEntity),
          useValue: mockImageRepo,
        },
        {
          provide: getRepositoryToken(SavedItemEntity),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(LocationEntity),
          useValue: mockLocationRepo,
        },
        { provide: CloudinaryService, useValue: mockCloudinary },
        DistanceService,
        { provide: ItemViewService, useValue: mockItemViewService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: SearchService, useValue: mockSearchService },
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

      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('records a deduplicated view for the requesting viewer', async () => {
      mockQueryBuilder = buildQueryBuilder(
        [mockItemEntity],
        [{ user_items_count: '1' }],
      );
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

  describe('pickup schedule', () => {
    const scheduledItem = () => ({
      ...mockItemEntity,
      pickup_type: PickupType.SPECIFIC_DATE,
      pickup_date: new Date('2026-07-01T00:00:00.000Z'),
      pickup_time: '14:30',
    });

    beforeEach(() => {
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([]);
    });

    it.each([
      ['anytime', PickupType.ANYTIME],
      ['contact_me', PickupType.CONTACT_ME],
    ])(
      'drops the old date and time when the type changes to %s',
      async (_label, pickupType) => {
        mockItemRepo.findOne.mockResolvedValue(scheduledItem());

        const updateDto = plainToInstance(UpdateItemDto, {
          pickup_type: pickupType,
        });
        const result = await service.update('user-1', 'item-1', updateDto);

        expect(result.data.pickup_type).toBe(pickupType);
        expect(result.data.pickup_date).toBeNull();
        expect(result.data.pickup_time).toBeNull();
      },
    );

    it('drops the old date and time when the type is cleared', async () => {
      mockItemRepo.findOne.mockResolvedValue(scheduledItem());

      const updateDto = plainToInstance(UpdateItemDto, { pickup_type: null });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.pickup_date).toBeNull();
      expect(result.data.pickup_time).toBeNull();
    });

    it('keeps the date when the type stays specific_date', async () => {
      mockItemRepo.findOne.mockResolvedValue(scheduledItem());

      const updateDto = plainToInstance(UpdateItemDto, {
        pickup_type: PickupType.SPECIFIC_DATE,
        title: 'New title',
      });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.pickup_date).toEqual(
        new Date('2026-07-01T00:00:00.000Z'),
      );
      expect(result.data.pickup_time).toBe('14:30');
    });

    it('leaves the schedule alone when the edit does not mention the type', async () => {
      mockItemRepo.findOne.mockResolvedValue(scheduledItem());

      const updateDto = plainToInstance(UpdateItemDto, { title: 'New title' });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.pickup_type).toBe(PickupType.SPECIFIC_DATE);
      expect(result.data.pickup_date).toEqual(
        new Date('2026-07-01T00:00:00.000Z'),
      );
      expect(result.data.pickup_time).toBe('14:30');
    });

    it('does not store a date posted alongside a non-scheduled type', async () => {
      mockItemRepo.create.mockImplementation((data: Partial<ItemEntity>) => ({
        ...data,
      }));

      const createDto = plainToInstance(CreateItemDto, {
        title: 'Bicycle',
        condition: ItemCondition.GOOD,
        pickup_type: PickupType.ANYTIME,
        pickup_date: '2026-07-01',
        pickup_time: '14:30',
      });
      const result = await service.create('user-1', createDto);

      expect(result.data.pickup_date).toBeNull();
      expect(result.data.pickup_time).toBeNull();
    });
  });

  describe('coordinates', () => {
    beforeEach(() => {
      mockItemRepo.create.mockImplementation((data: Partial<ItemEntity>) => ({
        ...data,
      }));
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve({ ...entity, id: entity.id ?? 'item-1' }),
      );
      mockImageRepo.find.mockResolvedValue([]);
    });

    it('creates an unattached location from coordinates on create', async () => {
      mockLocationRepo.save.mockResolvedValue({ id: 'loc-new' });

      const createDto = plainToInstance(CreateItemDto, {
        title: 'Bicycle',
        condition: ItemCondition.GOOD,
        latitude: '5.6037',
        longitude: '-0.187',
      });
      const result = await service.create('user-1', createDto);

      // Not tied to the poster, so it never shows up in their saved locations.
      expect(mockLocationRepo.create).toHaveBeenCalledWith({
        user_id: null,
        latitude: 5.6037,
        longitude: -0.187,
      });
      expect(result.data.location_id).toBe('loc-new');
    });

    it('does not write latitude or longitude onto the item row', async () => {
      mockLocationRepo.save.mockResolvedValue({ id: 'loc-new' });

      const createDto = plainToInstance(CreateItemDto, {
        title: 'Bicycle',
        condition: ItemCondition.GOOD,
        latitude: 5.6037,
        longitude: -0.187,
      });
      await service.create('user-1', createDto);

      const [created] = mockItemRepo.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(created).not.toHaveProperty('latitude');
      expect(created).not.toHaveProperty('longitude');
    });

    it('rejects a latitude sent without a longitude', async () => {
      const createDto = plainToInstance(CreateItemDto, {
        title: 'Bicycle',
        condition: ItemCondition.GOOD,
        latitude: 5.6037,
      });

      await expect(service.create('user-1', createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLocationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects coordinates sent alongside a location_id', async () => {
      const createDto = plainToInstance(CreateItemDto, {
        title: 'Bicycle',
        condition: ItemCondition.GOOD,
        location_id: '123e4567-e89b-12d3-a456-426614174000',
        latitude: 5.6037,
        longitude: -0.187,
      });

      await expect(service.create('user-1', createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLocationRepo.save).not.toHaveBeenCalled();
    });

    it('updates the throwaway location in place on a later edit', async () => {
      mockItemRepo.findOne.mockResolvedValue({
        ...mockItemEntity,
        location_id: 'loc-temp',
      });
      mockLocationRepo.findOne.mockResolvedValue({
        id: 'loc-temp',
        user_id: null,
        latitude: 5.6037,
        longitude: -0.187,
      });
      mockLocationRepo.save.mockImplementation((entity: LocationEntity) =>
        Promise.resolve(entity),
      );

      const updateDto = plainToInstance(UpdateItemDto, {
        latitude: 6.2,
        longitude: -1.1,
      });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(mockLocationRepo.create).not.toHaveBeenCalled();
      expect(mockLocationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'loc-temp',
          latitude: 6.2,
          longitude: -1.1,
        }),
      );
      expect(result.data.location_id).toBe('loc-temp');
    });

    it('never mutates a saved location, pointing at a new one instead', async () => {
      mockItemRepo.findOne.mockResolvedValue({
        ...mockItemEntity,
        location_id: 'loc-saved',
      });
      mockLocationRepo.findOne.mockResolvedValue({
        id: 'loc-saved',
        user_id: 'user-1',
        latitude: 5.6037,
        longitude: -0.187,
      });
      mockLocationRepo.save.mockResolvedValue({ id: 'loc-new' });

      const updateDto = plainToInstance(UpdateItemDto, {
        latitude: 6.2,
        longitude: -1.1,
      });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(mockLocationRepo.create).toHaveBeenCalledWith({
        user_id: null,
        latitude: 6.2,
        longitude: -1.1,
      });
      expect(result.data.location_id).toBe('loc-new');
    });
  });

  describe('update', () => {
    it('keeps fields the client did not send, including status', async () => {
      const stored = { ...mockItemEntity };
      mockItemRepo.findOne.mockResolvedValue(stored);
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );

      // Built the same way the global ValidationPipe builds it: declared but
      // unsent fields are present on the instance with value `undefined`.
      const updateDto = plainToInstance(UpdateItemDto, { title: 'New title' });
      expect('status' in updateDto).toBe(true);

      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.title).toBe('New title');
      expect(result.data.status).toBe(ItemStatus.AVAILABLE);
      expect(result.data.condition).toBe(ItemCondition.GOOD);
      expect(result.data.quantity).toBe(2);
    });

    it('applies status when the client does send it', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );

      const updateDto = plainToInstance(UpdateItemDto, {
        status: ItemStatus.UNAVAILABLE,
      });

      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.status).toBe(ItemStatus.UNAVAILABLE);
      expect(result.data.title).toBe('Test Item');
    });

    it('returns the existing images when the edit does not touch them', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);

      const updateDto = plainToInstance(UpdateItemDto, { title: 'New title' });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.images).toHaveLength(1);
      expect(result.data.images![0].id).toBe('img-1');
    });

    it('appends uploaded images after the existing ones', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([
        mockImage('img-1', 0, true),
        mockImage('img-2', 1, false),
      ]);

      const updateDto = plainToInstance(UpdateItemDto, {});
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('new.jpg'),
      ]);

      expect(mockCloudinary.uploadImage).toHaveBeenCalledTimes(1);
      expect(result.data.images).toHaveLength(3);
      // Continues the existing display order, and does not steal primary.
      expect(result.data.images![2].display_order).toBe(2);
      expect(result.data.images![2].is_primary).toBe(false);
      expect(result.data.images![0].is_primary).toBe(true);
    });

    it('removes the images listed in remove_image_ids', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      const keep = mockImage('img-1', 0, true);
      const drop = mockImage('img-2', 1, false);
      mockImageRepo.find.mockResolvedValue([keep, drop]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: 'img-2',
      });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(drop.is_deleted).toBe(true);
      expect(drop.deleted_at).toBeInstanceOf(Date);
      expect(result.data.images).toHaveLength(1);
      expect(result.data.images![0].id).toBe('img-1');
      expect(mockCloudinary.deleteImagesQuietly).toHaveBeenCalledWith([
        'public-img-2',
      ]);
    });

    it('promotes a remaining image to primary when the primary is removed', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([
        mockImage('img-1', 0, true),
        mockImage('img-2', 1, false),
      ]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-1'],
      });
      const result = await service.update('user-1', 'item-1', updateDto);

      expect(result.data.images).toHaveLength(1);
      expect(result.data.images![0].id).toBe('img-2');
      expect(result.data.images![0].is_primary).toBe(true);
    });

    it('rejects removing an image that belongs to another item', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-99'],
      });

      await expect(
        service.update('user-1', 'item-1', updateDto),
      ).rejects.toThrow(NotFoundException);
      // The rest of the edit must not have been persisted.
      expect(mockItemRepo.save).not.toHaveBeenCalled();
    });

    it('rejects removing every image when nothing replaces them', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-1'],
      });

      await expect(
        service.update('user-1', 'item-1', updateDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockItemRepo.save).not.toHaveBeenCalled();
    });

    it('allows removing every image when the request uploads replacements', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-1'],
      });
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('replacement.jpg'),
      ]);

      expect(result.data.images).toHaveLength(1);
      expect(result.data.images![0].display_order).toBe(0);
      // The replacement becomes primary, since the old primary is gone.
      expect(result.data.images![0].is_primary).toBe(true);
    });

    it('reports uploads that failed instead of silently dropping them', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([]);

      const updateDto = plainToInstance(UpdateItemDto, {});
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('good.jpg'),
        mockFile('fail-1.jpg'),
        mockFile('fail-2.jpg'),
      ]);

      expect(result.state).toBe(true);
      expect(result.data.images).toHaveLength(1);
      expect(result.message).toBe(
        'Item updated successfully, but 2 of 3 images failed to upload',
      );
      expect(result.warnings).toEqual([
        'Image "fail-1.jpg" could not be uploaded and was not saved.',
        'Image "fail-2.jpg" could not be uploaded and was not saved.',
      ]);
    });

    it('omits warnings when every upload succeeds', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([]);

      const updateDto = plainToInstance(UpdateItemDto, {});
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('good.jpg'),
      ]);

      expect(result.message).toBe('Item updated successfully');
      expect(result.warnings).toBeUndefined();
    });

    it('leaves no gap in display order when an upload in the middle fails', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);

      const updateDto = plainToInstance(UpdateItemDto, {});
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('first.jpg'),
        mockFile('fail.jpg'),
        mockFile('third.jpg'),
      ]);

      expect(result.data.images!.map((image) => image.display_order)).toEqual([
        0, 1, 2,
      ]);
    });

    it('keeps the existing images when every replacement upload fails', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      const original = mockImage('img-1', 0, true);
      mockImageRepo.find.mockResolvedValue([original]);

      const updateDto = plainToInstance(UpdateItemDto, {
        title: 'New title',
        remove_image_ids: ['img-1'],
      });

      await expect(
        service.update('user-1', 'item-1', updateDto, [
          mockFile('fail-1.jpg'),
          mockFile('fail-2.jpg'),
        ]),
      ).rejects.toThrow(BadRequestException);
      expect(original.is_deleted).toBe(false);
      expect(original.is_primary).toBe(true);
      expect(mockImageRepo.save).not.toHaveBeenCalled();
      expect(mockItemRepo.save).not.toHaveBeenCalled();
    });

    it('replaces every image when only some replacements upload', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      const oldA = mockImage('img-1', 0, true);
      const oldB = mockImage('img-2', 1, false);
      mockImageRepo.find.mockResolvedValue([oldA, oldB]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-1', 'img-2'],
      });
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('fail.jpg'),
        mockFile('new-a.jpg'),
        mockFile('new-b.jpg'),
      ]);

      expect(oldA.is_deleted).toBe(true);
      expect(oldB.is_deleted).toBe(true);
      expect(result.warnings).toHaveLength(1);
      const images = result.data.images!;
      expect(images.map((image) => image.display_order)).toEqual([0, 1]);
      expect(images.filter((image) => image.is_primary)).toHaveLength(1);
      expect(images[0].is_primary).toBe(true);
    });

    it('rolls back and deletes the new uploads when saving fails', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);
      mockImageRepo.save.mockRejectedValueOnce(new Error('db down'));

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-1'],
      });

      await expect(
        service.update('user-1', 'item-1', updateDto, [
          mockFile('new-a.jpg'),
          mockFile('new-b.jpg'),
        ]),
      ).rejects.toThrow('db down');
      expect(mockCloudinary.deleteImage).toHaveBeenCalledTimes(2);
      expect(mockCloudinary.deleteImage).toHaveBeenCalledWith(
        'public-new-a.jpg',
      );
      expect(mockCloudinary.deleteImage).toHaveBeenCalledWith(
        'public-new-b.jpg',
      );
    });

    it('does not upload anything when an image ID is invalid', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockImageRepo.find.mockResolvedValue([mockImage('img-1', 0, true)]);

      const updateDto = plainToInstance(UpdateItemDto, {
        remove_image_ids: ['img-99'],
      });

      await expect(
        service.update('user-1', 'item-1', updateDto, [mockFile('new.jpg')]),
      ).rejects.toThrow(NotFoundException);
      expect(mockCloudinary.uploadImage).not.toHaveBeenCalled();
    });

    it('leaves exactly one primary when stored data has several', async () => {
      mockItemRepo.findOne.mockResolvedValue({ ...mockItemEntity });
      mockItemRepo.save.mockImplementation((entity: ItemEntity) =>
        Promise.resolve(entity),
      );
      mockImageRepo.find.mockResolvedValue([
        mockImage('img-1', 0, true),
        mockImage('img-2', 3, true),
      ]);

      const updateDto = plainToInstance(UpdateItemDto, {});
      const result = await service.update('user-1', 'item-1', updateDto, [
        mockFile('new.jpg'),
      ]);

      const images = result.data.images!;
      expect(images.map((image) => image.is_primary)).toEqual([
        true,
        false,
        false,
      ]);
      expect(images.map((image) => image.display_order)).toEqual([0, 1, 2]);
    });
  });

  describe('findAll', () => {
    describe('text search and pagination', () => {
      const items = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          ...mockItemEntity,
          id: `item-${i + 1}`,
        })) as ItemEntity[];

      const useItems = (entities: ItemEntity[]) => {
        mockQueryBuilder = buildQueryBuilder(
          entities,
          entities.map(() => ({ user_items_count: '1' })),
        );
        mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      };

      it('matches title and description ignoring case and accents', async () => {
        useItems([]);

        await service.findAll({ query: '  Chaisé ', searcher_key: 'user-9' });

        const call = mockQueryBuilder.andWhere.mock.calls.find(
          ([sql]: [string]) => sql.includes(':search'),
        );
        expect(call).toBeDefined();
        const [sql, params] = call as [string, { search: string }];
        expect(sql).toContain('item.title');
        expect(sql).toContain('item.description');
        expect(sql).toContain('translate(lower(');
        expect(params.search).toBe('%chaise%');
      });

      it('treats LIKE wildcards in the query literally', async () => {
        useItems([]);

        await service.findAll({ query: '50%_off' });

        const [, params] = mockQueryBuilder.andWhere.mock.calls.find(
          ([sql]: [string]) => sql.includes(':search'),
        ) as [string, { search: string }];
        expect(params.search).toBe('%50\\%\\_off%');
      });

      it('records the first page of a search for popular terms', async () => {
        useItems([]);

        await service.findAll({ query: 'chair', searcher_key: 'user-9' });
        await service.findAll({
          query: 'chair',
          page: 2,
          searcher_key: 'user-9',
        });

        expect(mockSearchService.record).toHaveBeenCalledTimes(1);
        expect(mockSearchService.record).toHaveBeenCalledWith(
          'chair',
          'user-9',
        );
      });

      it('does not record or filter by text without a query', async () => {
        useItems([]);

        await service.findAll({ query: '   ' });

        expect(mockSearchService.record).not.toHaveBeenCalled();
        expect(
          mockQueryBuilder.andWhere.mock.calls.some(([sql]: [string]) =>
            sql.includes(':search'),
          ),
        ).toBe(false);
      });

      it('returns the requested page with total, page and limit', async () => {
        useItems(items(5));

        const result = await service.findAll({ page: 2, limit: 2 });

        expect(result.data.map((item) => item.id)).toEqual([
          'item-3',
          'item-4',
        ]);
        expect(result).toMatchObject({ total: 5, page: 2, limit: 2 });
      });

      it('returns every item when no page or limit is sent', async () => {
        useItems(items(3));

        const result = await service.findAll();

        expect(result.data).toHaveLength(3);
        expect(result.total).toBe(3);
        expect(result.page).toBeUndefined();
      });

      it('pages over items inside the radius only', async () => {
        const near = { ...mockItemEntity, id: 'near' } as ItemEntity;
        const far = {
          ...mockItemEntity,
          id: 'far',
          location: mockLocation(9.4034, -0.8424), // Tamale
        } as ItemEntity;
        useItems([far, near]);

        const result = await service.findAll({
          lat: 5.6037,
          lng: -0.187,
          page: 1,
          limit: 1,
        });

        expect(result.data.map((item) => item.id)).toEqual(['near']);
        expect(result.total).toBe(1);
      });
    });

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
      mockQueryBuilder = buildQueryBuilder(
        [entityWithoutUser],
        [{ user_items_count: '0' }],
      );
      mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAll();

      expect(result.data[0].user).toBeUndefined();
    });

    describe('proximity filtering', () => {
      // Item in Accra (5.6037, -0.1870)
      // Item in Kumasi (6.6885, -1.6244) — ~250km from Accra
      const accraItem = {
        ...mockItemEntity,
        id: 'item-accra',
        location: mockLocation(5.6037, -0.187),
      } as any;
      const kumasiItem = {
        ...mockItemEntity,
        id: 'item-kumasi',
        location: mockLocation(6.6885, -1.6244),
      } as any;
      const noLocationItem = {
        ...mockItemEntity,
        id: 'item-noloc',
        location: null,
      } as any;

      beforeEach(() => {
        mockQueryBuilder = buildQueryBuilder(
          [accraItem, kumasiItem, noLocationItem],
          [
            { user_items_count: '1' },
            { user_items_count: '2' },
            { user_items_count: '0' },
          ],
        );
        mockItemRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      });

      it('returns all items when no lat/lng provided', async () => {
        const result = await service.findAll();
        expect(result.data).toHaveLength(3);
      });

      it('filters to nearby items within default 10km radius', async () => {
        // Searching from Accra — only accraItem should be within 10km
        const result = await service.findAll({ lat: 5.6037, lng: -0.187 });
        const ids = result.data.map((d) => d.id);
        expect(ids).toContain('item-accra');
        expect(ids).not.toContain('item-kumasi');
      });

      it('includes items without a location regardless of radius', async () => {
        const result = await service.findAll({ lat: 5.6037, lng: -0.187 });
        const ids = result.data.map((d) => d.id);
        expect(ids).toContain('item-noloc');
      });

      it('includes distant items when radius is large enough', async () => {
        // 300km radius from Accra should include Kumasi (~250km away)
        const result = await service.findAll({
          lat: 5.6037,
          lng: -0.187,
          radius: 300,
        });
        const ids = result.data.map((d) => d.id);
        expect(ids).toContain('item-accra');
        expect(ids).toContain('item-kumasi');
      });

      it('excludes distant items when radius is small', async () => {
        const result = await service.findAll({
          lat: 5.6037,
          lng: -0.187,
          radius: 5,
        });
        const ids = result.data.map((d) => d.id);
        expect(ids).not.toContain('item-kumasi');
      });
    });
  });
});
