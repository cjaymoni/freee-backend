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
