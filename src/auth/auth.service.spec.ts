import * as bcrypt from 'bcrypt';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './auth.service';

type Row = {
  id: string;
  email: string | null;
  phone_number: string | null;
  is_email_verified: boolean;
  is_phone_verified: boolean;
};

describe('AuthService Firebase account linking', () => {
  // Only the linking helper is under test; it needs no injected services.
  const service = Object.create(AuthService.prototype) as {
    resolveFirebaseLink: (
      repo: unknown,
      token: { email?: string; emailVerified: boolean; phone_number?: string },
    ) => Promise<{ user: Row | null; usableEmail?: string }>;
  };

  let rows: Row[];
  const repo = {
    findOne: jest.fn(({ where }: { where: Partial<Row> }) =>
      Promise.resolve(
        rows.find((r) =>
          Object.entries(where).every(([k, v]) => r[k as keyof Row] === v),
        ) ?? null,
      ),
    ),
    update: jest.fn((id: string, patch: Partial<Row>) => {
      Object.assign(rows.find((r) => r.id === id)!, patch);
      return Promise.resolve();
    }),
  };
  const row = (over: Partial<Row>): Row => ({
    id: 'r',
    email: null,
    phone_number: null,
    is_email_verified: false,
    is_phone_verified: false,
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('does not link a Google sign-in to an account that only claimed the email', async () => {
    rows = [row({ id: 'attacker', email: 'victim@gmail.com' })];

    const result = await service.resolveFirebaseLink(repo, {
      email: 'victim@gmail.com',
      emailVerified: true,
    });

    expect(result.user).toBeNull();
    expect(result.usableEmail).toBe('victim@gmail.com');
    // The unverified claim is released so the victim's new account can hold it.
    expect(rows[0].email).toBeNull();
  });

  it('links when both sides have verified the email', async () => {
    rows = [
      row({ id: 'owner', email: 'me@gmail.com', is_email_verified: true }),
    ];

    const result = await service.resolveFirebaseLink(repo, {
      email: 'me@gmail.com',
      emailVerified: true,
    });

    expect(result.user?.id).toBe('owner');
  });

  it('does not link on an email the token has not verified', async () => {
    rows = [
      row({ id: 'owner', email: 'me@example.com', is_email_verified: true }),
    ];

    const result = await service.resolveFirebaseLink(repo, {
      email: 'me@example.com',
      emailVerified: false,
    });

    expect(result.user).toBeNull();
    expect(result.usableEmail).toBeUndefined();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('links on a verified phone number and releases an unverified one', async () => {
    rows = [
      row({ id: 'owner', phone_number: '+233201', is_phone_verified: true }),
    ];
    const linked = await service.resolveFirebaseLink(repo, {
      phone_number: '+233201',
      emailVerified: false,
    });
    expect(linked.user?.id).toBe('owner');

    rows = [row({ id: 'claimer', phone_number: '+233202' })];
    const released = await service.resolveFirebaseLink(repo, {
      phone_number: '+233202',
      emailVerified: false,
    });
    expect(released.user).toBeNull();
    expect(rows[0].phone_number).toBeNull();
  });
});

describe('AuthService.firebaseAuthenticate for a returning user', () => {
  type DbRow = Record<string, unknown> & { id: string };
  const uniqueViolation = () =>
    Object.assign(new QueryFailedError('UPDATE', [], new Error('dup')), {
      driverError: { code: '23505' },
    });

  const setup = (
    rows: DbRow[],
    token: Record<string, unknown>,
    {
      updateError,
      create,
    }: {
      updateError?: Error;
      create?: (dto: Record<string, unknown>) => Promise<unknown>;
    } = {},
  ) => {
    // Lookups hand out copies, so only what the service writes back counts:
    // a change made in memory and never saved fails the assertions.
    const find = (where: Record<string, unknown>) => {
      const row = rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
      return Promise.resolve(row ? { ...row } : null);
    };
    const userRepo = {
      findOne: ({ where }: { where: Record<string, unknown> }) => find(where),
      save: jest.fn((entity: DbRow) => {
        Object.assign(rows.find((r) => r.id === entity.id)!, entity);
        return Promise.resolve(entity);
      }),
      update: jest.fn(
        (
          criteria: string | Record<string, unknown>,
          values: Record<string, unknown>,
        ) => {
          if (updateError) return Promise.reject(updateError);
          const where =
            typeof criteria === 'string' ? { id: criteria } : criteria;
          const hit = rows.filter((r) =>
            Object.entries(where).every(([k, v]) => r[k] === v),
          );
          hit.forEach((r) => Object.assign(r, values));
          return Promise.resolve({ affected: hit.length });
        },
      ),
    };
    const sessionRepo = { create: (v: object) => v, save: jest.fn() };
    const manager = {
      getRepository: (entity: { name: string }) =>
        entity.name === 'UserEntity' ? userRepo : sessionRepo,
      // Savepoints are invisible here; the service's catch is what's tested.
      transaction: (run: (m: unknown) => unknown) => run(manager),
    };
    const service = Object.create(AuthService.prototype) as Record<
      string,
      unknown
    >;
    service.logger = { log: jest.fn(), error: jest.fn() };
    service.firebaseService = {
      verifyIdToken: jest.fn().mockResolvedValue({ uid: 'fb-1', ...token }),
    };
    service.dataSource = {
      transaction: (run: (m: typeof manager) => unknown) => run(manager),
    };
    service.jwtService = { sign: () => 'access-token' };
    const userService = {
      create: jest.fn(create ?? (() => Promise.reject(new Error('unused')))),
      invalidateUserCache: jest.fn(),
    };
    service.userService = userService;
    const signIn = () =>
      (service.firebaseAuthenticate as AuthService['firebaseAuthenticate'])(
        { idToken: 't' },
        '::1',
        'ua',
      );
    return { signIn, userRepo, userService };
  };
  const me = (over: Partial<DbRow> = {}): DbRow => ({
    id: 'u1',
    firebase_uid: 'fb-1',
    email: null,
    phone_number: null,
    is_email_verified: false,
    is_phone_verified: false,
    ...over,
  });

  it('fills in the verified email a linked Firebase account now carries', async () => {
    const rows = [me({ phone_number: '+233201', is_phone_verified: true })];
    const { signIn } = setup(rows, {
      phone_number: '+233201',
      email: 'Ama@Gmail.com',
      email_verified: true,
    });

    await signIn();

    expect(rows[0]).toMatchObject({
      email: 'ama@gmail.com',
      is_email_verified: true,
    });
  });

  it('fills in an unverified email but leaves it unverified', async () => {
    const rows = [me({ phone_number: '+233201', is_phone_verified: true })];
    const { signIn } = setup(rows, {
      phone_number: '+233201',
      email: 'ama@gmail.com',
      email_verified: false,
    });

    await signIn();

    expect(rows[0]).toMatchObject({
      email: 'ama@gmail.com',
      is_email_verified: false,
    });
  });

  it('leaves out an email another account has verified', async () => {
    const rows = [
      me({ phone_number: '+233201', is_phone_verified: true }),
      { id: 'u2', email: 'ama@gmail.com', is_email_verified: true },
    ];
    const { signIn } = setup(rows, {
      phone_number: '+233201',
      email: 'ama@gmail.com',
      email_verified: true,
    });

    await signIn();

    expect(rows[0]).toMatchObject({ email: null, is_email_verified: false });
    expect(rows[1].email).toBe('ama@gmail.com');
  });

  it('takes a verified email over from an account that only claimed it', async () => {
    const rows = [
      me({ phone_number: '+233201', is_phone_verified: true }),
      {
        id: 'u2',
        firebase_uid: 'fb-2',
        email: 'ama@gmail.com',
        is_email_verified: false,
      },
    ];
    const { signIn, userService } = setup(rows, {
      phone_number: '+233201',
      email: 'ama@gmail.com',
      email_verified: true,
    });

    await signIn();

    expect(rows[1].email).toBeNull();
    expect(rows[0]).toMatchObject({
      email: 'ama@gmail.com',
      is_email_verified: true,
    });
    // Both accounts' cached copies, or a password reset for this email
    // could still go to the account that gave it up.
    expect(userService.invalidateUserCache).toHaveBeenCalledWith({
      id: 'u2',
      firebase_uid: 'fb-2',
      email: 'ama@gmail.com',
    });
    expect(userService.invalidateUserCache).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'ama@gmail.com' }),
    );
  });

  it('keeps an email verified since the claim was read', async () => {
    const rows = [
      me({ phone_number: '+233201', is_phone_verified: true }),
      { id: 'u2', email: 'ama@gmail.com', is_email_verified: false },
    ];
    const { signIn, userRepo } = setup(rows, {
      phone_number: '+233201',
      email: 'ama@gmail.com',
      email_verified: true,
    });
    // The holder verifies between the service's read and its write.
    const read = userRepo.findOne;
    userRepo.findOne = async (query) => {
      const found = await read(query);
      if (found?.id === 'u2') rows[1].is_email_verified = true;
      return found;
    };

    await signIn();

    expect(rows[1].email).toBe('ama@gmail.com');
    expect(rows[0].email).toBeNull();
  });

  it('does not take an unverified email from another account', async () => {
    const rows = [
      me({ phone_number: '+233201', is_phone_verified: true }),
      { id: 'u2', email: 'ama@gmail.com', is_email_verified: false },
    ];
    const { signIn } = setup(rows, {
      phone_number: '+233201',
      email: 'ama@gmail.com',
      email_verified: false,
    });

    await signIn();

    expect(rows[0].email).toBeNull();
    expect(rows[1].email).toBe('ama@gmail.com');
  });

  it('leaves out a phone number another account has verified', async () => {
    const rows = [
      me({ email: 'ama@gmail.com', is_email_verified: true }),
      { id: 'u2', phone_number: '+233201', is_phone_verified: true },
    ];
    const { signIn } = setup(rows, {
      email: 'ama@gmail.com',
      email_verified: true,
      phone_number: '+233201',
    });

    await signIn();

    expect(rows[0].phone_number).toBeNull();
    expect(rows[1].phone_number).toBe('+233201');
  });

  it('takes a phone number over from an account that only claimed it', async () => {
    const rows = [
      me({ email: 'ama@gmail.com', is_email_verified: true }),
      { id: 'u2', phone_number: '+233201', is_phone_verified: false },
    ];
    const { signIn } = setup(rows, {
      email: 'ama@gmail.com',
      email_verified: true,
      phone_number: '+233201',
    });

    await signIn();

    expect(rows[1].phone_number).toBeNull();
    expect(rows[0]).toMatchObject({
      phone_number: '+233201',
      is_phone_verified: true,
    });
  });

  it('still signs in when a concurrent request claims the email first', async () => {
    const rows = [me({ phone_number: '+233201', is_phone_verified: true })];
    const { signIn } = setup(
      rows,
      { phone_number: '+233201', email: 'ama@gmail.com', email_verified: true },
      { updateError: uniqueViolation() },
    );

    const response = await signIn();

    expect(response.statusCode).toBe(200);
    expect(rows[0].email).toBeNull();
  });

  it('fails the sign-in on an error that is not a conflict', async () => {
    const rows = [me({ phone_number: '+233201', is_phone_verified: true })];
    const { signIn } = setup(
      rows,
      { phone_number: '+233201', email: 'ama@gmail.com', email_verified: true },
      { updateError: new Error('connection lost') },
    );

    await expect(signIn()).rejects.toThrow('connection lost');
  });

  describe('when a concurrent first sign-in creates the account', () => {
    const lose = (rows: DbRow[], competitor: DbRow) => () => {
      rows.push(competitor);
      return Promise.reject(uniqueViolation());
    };

    it('adopts the account the same Firebase user created and fills it', async () => {
      const rows: DbRow[] = [];
      const { signIn } = setup(
        rows,
        {
          phone_number: '+233201',
          email: 'ama@gmail.com',
          email_verified: true,
        },
        { create: lose(rows, me({ phone_number: '+233201' })) },
      );

      const response = await signIn();

      expect(response.data.user.id).toBe('u1');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        email: 'ama@gmail.com',
        is_email_verified: true,
        phone_number: '+233201',
        is_phone_verified: true,
      });
    });

    it('does not adopt an account another Firebase user created', async () => {
      const rows: DbRow[] = [];
      const { signIn } = setup(
        rows,
        { phone_number: '+233201' },
        { create: lose(rows, me({ id: 'u2', firebase_uid: 'fb-2' })) },
      );

      await expect(signIn()).rejects.toBeInstanceOf(QueryFailedError);
    });
  });

  it('does not verify a stored email the token does not carry', async () => {
    const rows = [me({ email: 'victim@gmail.com' })];
    const { signIn } = setup(rows, {
      email: 'mine@gmail.com',
      email_verified: true,
      phone_number: '+2332',
    });

    await signIn();

    expect(rows[0].is_email_verified).toBe(false);
  });

  it('does not verify the stored email when the token has not verified it', async () => {
    const rows = [me({ email: 'ama@gmail.com' })];
    const { signIn } = setup(rows, {
      email: 'ama@gmail.com',
      email_verified: false,
    });

    await signIn();

    expect(rows[0].is_email_verified).toBe(false);
  });

  it('does not verify a stored phone number the token does not carry', async () => {
    const rows = [me({ phone_number: '+233999' })];
    const { signIn } = setup(rows, { phone_number: '+233201' });

    await signIn();

    expect(rows[0].is_phone_verified).toBe(false);
  });

  it('verifies the email of an account it links to by phone', async () => {
    // Not found by Firebase UID: a first sign-in that links on the number.
    const rows = [
      me({
        firebase_uid: 'fb-old',
        phone_number: '+233201',
        is_phone_verified: true,
        email: 'ama@gmail.com',
      }),
    ];
    const { signIn } = setup(rows, {
      phone_number: '+233201',
      email: 'ama@gmail.com',
      email_verified: true,
    });

    await signIn();

    expect(rows[0]).toMatchObject({
      firebase_uid: 'fb-1',
      is_email_verified: true,
    });
  });
});

describe('AuthService wrong verification codes', () => {
  const makeRunner = () => {
    const runner = {
      isTransactionActive: false,
      connect: jest.fn(),
      startTransaction: jest.fn(() => {
        runner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(() => {
        runner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(() => {
        if (!runner.isTransactionActive) {
          throw new Error('TransactionNotStartedError');
        }
        runner.isTransactionActive = false;
      }),
      release: jest.fn(),
      manager: {
        findOne: jest.fn().mockResolvedValue({
          code_hash:
            '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
          attempt_count: 0,
          expires_at: new Date(Date.now() + 60_000),
          user: { id: 'u1' },
        }),
        save: jest.fn(),
      },
    };
    return runner;
  };

  it.each([
    [
      'verifyEmail',
      { email: 'a@example.com', code: '000000' },
      'Invalid verification code',
    ],
    [
      'resetPassword',
      { email: 'a@example.com', code: '000000', password: 'NewPass123' },
      'Invalid reset code',
    ],
  ])('%s answers 400, not a rollback error', async (method, dto, message) => {
    const runner = makeRunner();
    const service = Object.create(AuthService.prototype) as Record<
      string,
      unknown
    >;
    service.dataSource = { createQueryRunner: () => runner };

    await expect(
      (service[method] as (d: object) => Promise<unknown>)(dto),
    ).rejects.toThrow(message);
    expect(runner.manager.save).toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  const setup = (ended: { affected: number; raw: object[] }) => {
    const created: Record<string, unknown>[] = [];
    const endQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(ended),
    };
    const runner = {
      isTransactionActive: false,
      connect: jest.fn(),
      startTransaction: jest.fn(() => {
        runner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn(() => {
        runner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn(() => {
        runner.isTransactionActive = false;
      }),
      release: jest.fn(),
      manager: {
        createQueryBuilder: () => endQuery,
        create: jest.fn((_entity: unknown, values: Record<string, unknown>) => {
          created.push(values);
          return values;
        }),
        save: jest.fn(),
      },
    };
    const service = Object.create(AuthService.prototype) as Record<
      string,
      unknown
    >;
    service.userSessionRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'old-session',
        user: { id: 'u1', email: 'a@example.com', role: 'USER' },
        device_type: 'android',
        fcm_token: 'read-before-the-transaction',
        refresh_token_expires_at: new Date(Date.now() + 60_000),
      }),
    };
    service.dataSource = { createQueryRunner: () => runner };
    service.jwtService = { sign: () => 'access-token' };
    const refresh = () =>
      (service.refresh as AuthService['refresh'])('refresh-1', '::1', 'ua');
    return { refresh, created, endQuery, runner };
  };

  it('carries the push token read as the old session ends', async () => {
    const { refresh, created, endQuery } = setup({
      affected: 1,
      raw: [{ fcm_token: 'fcm-registered-meanwhile' }],
    });

    await refresh();

    expect(endQuery.where).toHaveBeenCalledWith(
      'id = :id AND is_active = true',
      { id: 'old-session' },
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      device_type: 'android',
      fcm_token: 'fcm-registered-meanwhile',
    });
  });

  it('refuses a refresh that lost the race to another one', async () => {
    const { refresh, created, runner } = setup({ affected: 0, raw: [] });

    await expect(refresh()).rejects.toThrow('Invalid or expired refresh token');
    expect(created).toHaveLength(0);
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });
});

describe('AuthService.login with a device token', () => {
  it('registers the token on the new session and takes it off others', async () => {
    const created: Record<string, unknown>[] = [];
    const released: Record<string, unknown>[] = [];
    const releaseQuery: Record<string, jest.Mock> = {};
    Object.assign(releaseQuery, {
      update: jest.fn(() => releaseQuery),
      set: jest.fn(() => releaseQuery),
      where: jest.fn((_sql: string, params: Record<string, unknown>) => {
        released.push(params);
        return releaseQuery;
      }),
      andWhere: jest.fn((_sql: string, params?: Record<string, unknown>) => {
        if (params) released.push(params);
        return releaseQuery;
      }),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    });
    const runner = {
      isTransactionActive: false,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        create: jest.fn((_entity: unknown, values: Record<string, unknown>) => {
          created.push(values);
          return values;
        }),
        save: jest.fn(),
        update: jest.fn(),
        createQueryBuilder: () => releaseQuery,
      },
    };
    const service = Object.create(AuthService.prototype) as Record<
      string,
      unknown
    >;
    service.userService = {
      findByEmailWithPassword: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'ama@example.com',
        is_active: true,
        password_hash: await bcrypt.hash('secret1', 4),
      }),
    };
    service.accountLockoutService = {
      isAccountLocked: jest.fn().mockResolvedValue(false),
      resetFailedAttempts: jest.fn(),
    };
    service.dataSource = { createQueryRunner: () => runner };
    service.jwtService = { sign: () => 'access-token' };

    await (service.login as AuthService['login'])(
      { email: 'ama@example.com', password: 'secret1', fcm_token: 'fcm-phone' },
      '::1',
      'ua',
    );

    const session = created.find((values) => 'session_token' in values)!;
    expect(session.fcm_token).toBe('fcm-phone');
    expect(released).toEqual([
      { fcmToken: 'fcm-phone' },
      { keepSessionToken: session.session_token },
    ]);
  });
});
