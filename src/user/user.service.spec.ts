import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { UserResponseDto } from './dto/user-response.dto';
import { FirebaseService } from '../firebase/firebase.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DataSource } from 'typeorm';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { ItemEntity } from '../item/entities/item.entity';
import { ItemImageEntity } from '../item/entities/item-image.entity';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: CloudinaryService,
          useValue: {
            uploadImage: jest.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(),
          },
        },
        { provide: FirebaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('UserService.update verification flags', () => {
  const existing = {
    id: 'u1',
    email: 'old@example.com',
    phone_number: '+233200000000',
    is_email_verified: true,
    is_phone_verified: true,
    is_onboarded: true,
  };
  let service: UserService;
  let manager: { findOne: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserEntity), useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: { del: jest.fn() } },
        { provide: DataSource, useValue: {} },
        { provide: FirebaseService, useValue: {} },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
    manager = {
      findOne: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(undefined),
    };
  });

  const run = (dto: Record<string, unknown>) =>
    service.update('u1', dto, manager as never);
  const written = () =>
    (manager.update.mock.calls as unknown[][])[0][2] as Record<string, unknown>;

  it('clears is_email_verified when the email changes', async () => {
    await run({ email: 'new@example.com' });
    expect(written()).toMatchObject({
      email: 'new@example.com',
      is_email_verified: false,
    });
  });

  it('clears is_phone_verified when the phone number changes', async () => {
    await run({ phone_number: '+233201111111' });
    expect(written()).toMatchObject({ is_phone_verified: false });
  });

  it('keeps the flags when the same values are sent back', async () => {
    await run({ email: existing.email, phone_number: existing.phone_number });
    expect(written()).not.toHaveProperty('is_email_verified');
    expect(written()).not.toHaveProperty('is_phone_verified');
  });

  it('respects an explicit flag from an admin', async () => {
    await run({ email: 'new@example.com', is_email_verified: true });
    expect(written()).toMatchObject({ is_email_verified: true });
  });
});

describe('UserService.remove', () => {
  it('releases identifiers, ends sessions, takes down listings and their images', async () => {
    const images = [
      { id: 'img-1', cloudinary_public_id: 'items/one' },
      { id: 'img-2', cloudinary_public_id: 'items/two' },
    ];
    const manager = {
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        firebase_uid: 'fb-1',
        cloudinary_avatar_public_id: 'avatars/user_u1',
      }),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(images),
      })),
    };
    const cloudinary = {
      deleteImagesQuietly: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserEntity), useValue: {} },
        { provide: CloudinaryService, useValue: cloudinary },
        { provide: CACHE_MANAGER, useValue: { del: jest.fn() } },
        {
          provide: DataSource,
          useValue: {
            transaction: (work: (m: typeof manager) => unknown) =>
              work(manager),
          },
        },
        { provide: FirebaseService, useValue: {} },
      ],
    }).compile();
    const service = module.get<UserService>(UserService);

    await service.remove('u1', 'u1');

    const calls = manager.update.mock.calls as unknown[][];
    const byEntity = (entity: unknown) =>
      calls.find(([target]) => target === entity);

    expect(byEntity(UserEntity)?.[2]).toMatchObject({
      is_deleted: true,
      is_active: false,
      email: null,
      phone_number: null,
      firebase_uid: null,
      cloudinary_avatar_public_id: null,
      cloudinary_avatar_url: null,
    });
    expect(byEntity(UserSessionEntity)?.[2]).toEqual({ is_active: false });
    expect(byEntity(ItemEntity)?.[1]).toEqual({
      user_id: 'u1',
      is_deleted: false,
    });
    expect(byEntity(ItemEntity)?.[2]).toMatchObject({ is_deleted: true });
    expect(byEntity(ItemImageEntity)?.[1]).toEqual(['img-1', 'img-2']);
    expect(byEntity(ItemImageEntity)?.[2]).toMatchObject({ is_deleted: true });
    expect(cloudinary.deleteImagesQuietly).toHaveBeenCalledWith([
      'items/one',
      'items/two',
      'avatars/user_u1',
    ]);
  });
});

describe('UserService.updatePhoneFromFirebase', () => {
  let service: UserService;
  let update: jest.SpyInstance;
  const firebase = { verifyIdToken: jest.fn() };
  const repo = { findOne: jest.fn() };
  const user = {
    id: 'u1',
    firebase_uid: 'fb-1',
    phone_number: '+233200000001',
    is_phone_verified: true,
    is_deleted: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserEntity), useValue: repo },
        { provide: CloudinaryService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: { del: jest.fn() } },
        { provide: DataSource, useValue: {} },
        { provide: FirebaseService, useValue: firebase },
      ],
    }).compile();

    service = module.get(UserService);
    update = jest.spyOn(service, 'update').mockImplementation((_id, dto) =>
      Promise.resolve({
        message: 'User updated successfully',
        data: { ...user, ...dto } as UserResponseDto,
        state: true,
        statusCode: 200,
      }),
    );
  });

  afterEach(() => jest.resetAllMocks());

  const statusOf = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (error: { getStatus: () => number }) => error.getStatus(),
    );

  it('saves the phone from the verified token as verified', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb-1',
      phone_number: '+233200000002',
    });
    repo.findOne.mockResolvedValueOnce({ ...user }).mockResolvedValueOnce(null);

    const result = await service.updatePhoneFromFirebase('u1', 'token');

    expect(update).toHaveBeenCalledWith('u1', {
      phone_number: '+233200000002',
      is_phone_verified: true,
    });
    expect(result.data.phone_number).toBe('+233200000002');
  });

  it('rejects an invalid token without touching the profile', async () => {
    firebase.verifyIdToken.mockRejectedValue(new Error('expired'));

    expect(await statusOf(service.updatePhoneFromFirebase('u1', 't'))).toBe(
      401,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a token from a different Firebase account', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb-other',
      phone_number: '+233200000002',
    });
    repo.findOne.mockResolvedValue({ ...user });

    expect(await statusOf(service.updatePhoneFromFirebase('u1', 't'))).toBe(
      403,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a user with no linked Firebase account', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb-1',
      phone_number: '+233200000002',
    });
    repo.findOne.mockResolvedValue({ ...user, firebase_uid: null });

    expect(await statusOf(service.updatePhoneFromFirebase('u1', 't'))).toBe(
      403,
    );
  });

  it('rejects a token without a phone number', async () => {
    firebase.verifyIdToken.mockResolvedValue({ uid: 'fb-1' });

    expect(await statusOf(service.updatePhoneFromFirebase('u1', 't'))).toBe(
      400,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a number already linked to another account', async () => {
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb-1',
      phone_number: '+233200000002',
    });
    repo.findOne
      .mockResolvedValueOnce({ ...user })
      .mockResolvedValueOnce({ id: 'u2', phone_number: '+233200000002' });

    expect(await statusOf(service.updatePhoneFromFirebase('u1', 't'))).toBe(
      409,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
