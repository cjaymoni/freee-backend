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
    is_active: true,
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

  it('answers an email that belongs to another account with 409', async () => {
    manager.findOne.mockImplementation(
      (_e: unknown, { where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.id ? existing : { id: 'someone-else', email: where.email },
        ),
    );
    await expect(run({ email: 'taken@example.com' })).rejects.toThrow(
      'Email already exists',
    );
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('answers a phone number that belongs to another account with 409', async () => {
    manager.findOne.mockImplementation(
      (_e: unknown, { where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.id ? existing : { id: 'someone-else', ...where }),
    );
    await expect(run({ phone_number: '+233209999999' })).rejects.toThrow(
      'Phone number already exists',
    );
  });

  it.each(['suspended', 'banned'])(
    'never reactivates a %s account (email verification sets is_active)',
    async (account_status) => {
      manager.findOne.mockResolvedValue({
        ...existing,
        is_active: false,
        account_status,
      });
      await run({ is_active: true, is_email_verified: true });
      expect(written()).toEqual({ is_email_verified: true });
    },
  );

  it('activates a verified sign-up whose account is not blocked', async () => {
    manager.findOne.mockResolvedValue({
      ...existing,
      is_active: false,
      account_status: 'active',
    });
    await run({ is_active: true, is_email_verified: true });
    expect(written()).toMatchObject({ is_active: true });
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
      // No active item requests to close.
      find: jest.fn().mockResolvedValue([]),
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

describe('UserService.create from POST /user (actingUserId)', () => {
  const me = {
    id: 'me',
    email: 'me@example.com',
    phone_number: '+233200000001',
    firebase_uid: 'fb-me',
    password_hash: null as string | null,
    is_email_verified: true,
    is_phone_verified: true,
    is_active: true,
    is_onboarded: false,
    cloudinary_avatar_url: 'https://x/me.png',
  };
  const other = { id: 'other', email: 'admin@example.com' };
  let service: UserService;
  let manager: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let caller: typeof me;

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
    caller = { ...me };
    const qb = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(() => Promise.resolve(caller)),
    };
    manager = {
      createQueryBuilder: jest.fn(() => qb),
      // Lookups by identifier find the other account; by id, the caller.
      findOne: jest.fn(
        (_e: unknown, { where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where.id === 'me'
              ? caller
              : where.email === other.email
                ? other
                : null,
          ),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
  });

  const run = (dto: Record<string, unknown>) =>
    service.create(
      dto as never,
      undefined,
      { actingUserId: 'me' },
      manager as never,
    );

  it("rejects another account's email instead of patching that account", async () => {
    await expect(
      run({ email: other.email, password: 'Hacked123!' }),
    ).rejects.toThrow('Email already exists');
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('patches only the caller, whatever identifiers the body carries', async () => {
    await run({ first_name: 'Ama', firebase_uid: 'fb-someone-else' });
    expect(manager.update).toHaveBeenCalledTimes(1);
    const [, id, data] = manager.update.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe('me');
    expect(data).toMatchObject({ first_name: 'Ama', firebase_uid: 'fb-me' });
  });

  it('refuses to overwrite an existing password', async () => {
    caller.password_hash = 'hash';
    await expect(run({ password: 'new-pass-1' })).rejects.toThrow(
      '/auth/change-password',
    );
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('clears is_email_verified when the caller changes to a free email', async () => {
    await run({ email: 'new@example.com' });
    const [, , data] = manager.update.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(data).toMatchObject({
      email: 'new@example.com',
      is_email_verified: false,
      is_onboarded: false,
    });
  });
});

describe('UserService.setAccountState', () => {
  const cache = { del: jest.fn() };
  const execute = jest.fn();
  const where = jest.fn();
  const qb = {
    update: () => qb,
    set: () => qb,
    where: (...args: unknown[]) => {
      where(...args);
      return qb;
    },
    execute,
  };
  const manager = { createQueryBuilder: () => qb };
  const service = Object.create(UserService.prototype) as UserService;
  Object.assign(service, {
    cacheManager: cache,
    userRepository: { manager },
  });
  const user = { id: 'u1', email: 'a@b.c', firebase_uid: 'fb1' };
  const state = {
    is_active: false,
    account_status: 'suspended',
    status_reason: 'x',
    suspended_until: null,
    status_changed_by: 'mod',
  } as never;

  beforeEach(() => jest.clearAllMocks());

  it('writes only while the account is in the status the caller read', async () => {
    execute.mockResolvedValue({ affected: 1 });

    await expect(
      service.setAccountState(user as never, 'active' as never, state),
    ).resolves.toBe(true);

    expect(where).toHaveBeenCalledWith(
      'id = :id AND account_status = :from',
      { id: 'u1', from: 'active' },
    );
    expect(cache.del.mock.calls.map(([key]) => key as string)).toEqual([
      'user:id:u1',
      'user:email:a@b.c',
      'user:firebase_uid:fb1',
    ]);
  });

  it('reports a lost race and leaves the cache alone', async () => {
    execute.mockResolvedValue({ affected: 0 });

    await expect(
      service.setAccountState(user as never, 'active' as never, state),
    ).resolves.toBe(false);
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('leaves clearing the cache to the caller inside a transaction', async () => {
    execute.mockResolvedValue({ affected: 1 });

    await service.setAccountState(
      user as never,
      'active' as never,
      state,
      manager as never,
    );
    expect(cache.del).not.toHaveBeenCalled();
  });
});
