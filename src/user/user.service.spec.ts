import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DataSource } from 'typeorm';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { ItemEntity } from '../item/entities/item.entity';

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
  it('releases identifiers, ends sessions and takes down listings', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserEntity), useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: { del: jest.fn() } },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();
    const service = module.get<UserService>(UserService);
    const manager = {
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        firebase_uid: 'fb-1',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };

    await service.remove('u1', 'u1', manager as never);

    const calls = manager.update.mock.calls as unknown[][];
    const byEntity = (entity: unknown) =>
      calls.find(([target]) => target === entity);

    expect(byEntity(UserEntity)?.[2]).toMatchObject({
      is_deleted: true,
      is_active: false,
      email: null,
      phone_number: null,
      firebase_uid: null,
    });
    expect(byEntity(UserSessionEntity)?.[2]).toEqual({ is_active: false });
    expect(byEntity(ItemEntity)?.[1]).toEqual({
      user_id: 'u1',
      is_deleted: false,
    });
    expect(byEntity(ItemEntity)?.[2]).toMatchObject({ is_deleted: true });
  });
});
