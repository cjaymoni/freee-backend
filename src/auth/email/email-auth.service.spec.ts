import {
  BadRequestException,
  ConflictException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { FindOperator, Repository } from 'typeorm';
import { FirebaseService } from '../../firebase/firebase.service';
import { MailService } from '../../mail/mail.service';
import { UserEntity } from '../../user/entities/user.entity';
import { UserService } from '../../user/user.service';
import { VerificationCodeEntity } from '../entities/verification-code.entity';
import { EmailAuthService } from './email-auth.service';

const EMAIL = 'ama@example.com';

type Where = Record<string, unknown>;

function setup(env: Record<string, unknown> = {}) {
  const config = {
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  } as unknown as ConfigService;
  const codes = {
    findOne: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(false),
    count: jest.fn().mockResolvedValue(0),
    sum: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((row: object) => row),
    save: jest.fn((row: object) => Promise.resolve({ id: 'code-1', ...row })),
  };
  const userRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(false),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const mail = { sendEmailCode: jest.fn().mockResolvedValue(undefined) };
  const firebase = {
    findUser: jest.fn().mockResolvedValue(null),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    createProvenEmailUser: jest.fn().mockResolvedValue({ uid: 'fresh' }),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    setProvenEmail: jest.fn().mockResolvedValue(undefined),
    createCustomToken: jest.fn((uid: string) =>
      Promise.resolve(`token:${uid}`),
    ),
  };
  const users = {
    assertCanLinkEmail: jest
      .fn()
      .mockResolvedValue({ id: 'user-1', firebase_uid: 'fb-1' }),
    linkProvenEmail: jest.fn().mockResolvedValue({ state: true }),
    clearUserCache: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EmailAuthService(
    config,
    codes as unknown as Repository<VerificationCodeEntity>,
    userRepo as unknown as Repository<UserEntity>,
    mail as unknown as MailService,
    firebase as unknown as FirebaseService,
    users as unknown as UserService,
  );
  return { service, codes, userRepo, mail, firebase, users };
}

/** A stored code row for `code`, as findOne returns it. */
async function storedCode(code: string) {
  return {
    id: 'code-1',
    code_hash: await bcrypt.hash(code, 4),
    created_at: new Date(Date.now() - 120_000),
  };
}

/** A Firebase user record with these sign-in methods. */
const fbUser = (uid: string, emailVerified: boolean, providers: string[]) => ({
  uid,
  email: EMAIL,
  emailVerified,
  providerData: providers.map((providerId) => ({ providerId })),
});

/** The where-clause of the nth update call. */
const updateWhere = (codes: ReturnType<typeof setup>['codes'], n: number) =>
  (codes.update.mock.calls[n] as [Where, Where])[0];

describe('EmailAuthService.getConfig', () => {
  it('defaults to Firebase links with server codes as the fallback', () => {
    expect(setup().service.getConfig()).toEqual({
      provider: 'firebase',
      fallback: 'server',
    });
  });

  it('switches to server codes only', () => {
    expect(setup({ EMAIL_PROVIDER: 'server' }).service.getConfig()).toEqual({
      provider: 'server',
      fallback: null,
    });
  });
});

describe('EmailAuthService sending codes', () => {
  it('stores only a hash of the code and emails the code', async () => {
    const { service, codes, mail } = setup();
    await service.sendSignInCode(EMAIL, '1.2.3.4');
    const [, code] = mail.sendEmailCode.mock.calls[0] as [string, string];
    const saved = codes.save.mock.calls[0][0] as { code_hash: string };
    expect(code).toMatch(/^\d{6}$/);
    expect(saved.code_hash).not.toContain(code);
    expect(await bcrypt.compare(code, saved.code_hash)).toBe(true);
  });

  it('refuses a new code within a minute of the last', async () => {
    const { service, codes, mail } = setup();
    codes.exists.mockResolvedValue(true);
    await expect(service.sendSignInCode(EMAIL, 'ip')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(mail.sendEmailCode).not.toHaveBeenCalled();
  });

  it.each([
    ['5 from this IP in the last hour', [5, 5]],
    ['20 in the last day', [0, 20]],
  ])('caps codes per email: %s', async (_, [fromIp, inDay]) => {
    const { service, codes, mail } = setup();
    codes.count.mockResolvedValueOnce(fromIp).mockResolvedValueOnce(inDay);
    await expect(service.sendSignInCode(EMAIL, 'ip')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(mail.sendEmailCode).not.toHaveBeenCalled();
  });

  it('counts the caps by email and IP, and by email alone, whoever asked', async () => {
    const { service, codes } = setup();
    await service.sendAddEmailCode('user-1', EMAIL, '1.2.3.4');
    const [[ipCap], [dayCap]] = codes.count.mock.calls as [{ where: Where }][];
    expect(ipCap.where).toMatchObject({ email: EMAIL, ip_address: '1.2.3.4' });
    expect(dayCap.where).toMatchObject({ email: EMAIL });
    expect(dayCap.where).not.toHaveProperty('ip_address');
    expect(dayCap.where).not.toHaveProperty('user');
  });

  it("deletes the code when the email can't be sent, so it counts toward nothing", async () => {
    const { service, codes, mail } = setup();
    mail.sendEmailCode.mockRejectedValue(new Error('smtp down'));
    await expect(service.sendSignInCode(EMAIL, 'ip')).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(codes.delete).toHaveBeenCalledWith('code-1');
  });

  it('refuses to send while server codes are switched off', async () => {
    const { service, mail } = setup({ EMAIL_FALLBACK_ENABLED: false });
    await expect(service.sendSignInCode(EMAIL, 'ip')).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(mail.sendEmailCode).not.toHaveBeenCalled();
  });

  it("scopes an add-email code's resend gap and expiry to the user", async () => {
    const { service, codes } = setup();
    await service.sendAddEmailCode('user-1', EMAIL, 'ip');
    const [{ where }] = codes.exists.mock.calls[0] as [{ where: Where }];
    expect(where).toMatchObject({ user: { id: 'user-1' } });
    expect(updateWhere(codes, 0)).toMatchObject({ user: { id: 'user-1' } });
  });

  it('sends no add-email code for an email that would get a 409', async () => {
    const { service, users, mail } = setup();
    users.assertCanLinkEmail.mockRejectedValue(new ConflictException());
    await expect(
      service.sendAddEmailCode('user-1', EMAIL, 'ip'),
    ).rejects.toThrow(ConflictException);
    expect(mail.sendEmailCode).not.toHaveBeenCalled();
  });

  it('sends no add-email code when another account has it verified on Firebase', async () => {
    const { service, firebase, mail, userRepo } = setup();
    firebase.findUserByEmail.mockResolvedValue(fbUser('other', true, []));
    userRepo.exists.mockResolvedValue(true);
    await expect(
      service.sendAddEmailCode('user-1', EMAIL, 'ip'),
    ).rejects.toThrow(ConflictException);
    expect(mail.sendEmailCode).not.toHaveBeenCalled();
  });

  it('deletes nothing while only checking before sending', async () => {
    const { service, firebase, mail } = setup();
    // No backend account behind it: it would be deleted on a right code.
    firebase.findUserByEmail.mockResolvedValue(
      fbUser('other', false, ['password']),
    );
    await service.sendAddEmailCode('user-1', EMAIL, 'ip');
    expect(firebase.deleteUser).not.toHaveBeenCalled();
    expect(mail.sendEmailCode).toHaveBeenCalled();
  });
});

describe('EmailAuthService checking sign-in codes', () => {
  it('trades a right code for a Firebase custom token', async () => {
    const { service, codes } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    await expect(service.verifySignInCode(EMAIL, '123456')).resolves.toEqual({
      firebase_token: 'token:fresh',
    });
  });

  it('counts the guess atomically, only while guesses remain, before comparing', async () => {
    const { service, codes } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    await expect(service.verifySignInCode(EMAIL, '654321')).rejects.toThrow(
      "That code isn't right.",
    );
    const where = updateWhere(codes, 0);
    expect(where).toMatchObject({ id: 'code-1', is_verified: false });
    expect(where.attempt_count).toBeInstanceOf(FindOperator);
    expect((where.attempt_count as FindOperator<number>).value).toBe(5);
    expect(where.expires_at).toBeInstanceOf(FindOperator);
    const values = (codes.update.mock.calls[0] as [Where, Where])[1];
    expect((values.attempt_count as () => string)()).toBe('attempt_count + 1');
  });

  it('refuses without comparing once no guesses remain or the code expired', async () => {
    const { service, codes, firebase } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    codes.update.mockResolvedValueOnce({ affected: 0 });
    // The right code, refused: the limit applies before the comparison.
    await expect(service.verifySignInCode(EMAIL, '123456')).rejects.toThrow(
      'That code has expired. Send a new one.',
    );
    expect(firebase.createCustomToken).not.toHaveBeenCalled();
  });

  it('stops checking an email after 30 wrong guesses in a day, before counting', async () => {
    const { service, codes, firebase } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    codes.sum.mockResolvedValue(30);
    await expect(
      service.verifySignInCode(EMAIL, '123456'),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    // Counted across sign-in and add-email codes alike.
    const [column, where] = codes.sum.mock.calls[0] as [string, Where];
    expect(column).toBe('attempt_count');
    expect(where).toMatchObject({ email: EMAIL });
    // Sign-in and add-email codes, not password-reset or verification ones.
    expect((where.code_type as FindOperator<string[]>).value).toEqual([
      'email_signin',
      'email_link',
    ]);
    expect(codes.update).not.toHaveBeenCalled();
    expect(firebase.createCustomToken).not.toHaveBeenCalled();
  });

  it('refuses when there is no code', async () => {
    const { service } = setup();
    await expect(service.verifySignInCode(EMAIL, '123456')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lets only one of two racing requests use a code', async () => {
    const { service, codes, firebase } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    codes.update
      .mockResolvedValueOnce({ affected: 1 }) // guess counted
      .mockResolvedValueOnce({ affected: 0 }); // already used
    await expect(service.verifySignInCode(EMAIL, '123456')).rejects.toThrow(
      BadRequestException,
    );
    expect(firebase.createCustomToken).not.toHaveBeenCalled();
  });

  it('gives the code back when Firebase fails, so it can be retried', async () => {
    const { service, codes, firebase } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    firebase.createProvenEmailUser.mockRejectedValue(new Error('down'));
    await expect(service.verifySignInCode(EMAIL, '123456')).rejects.toThrow(
      'down',
    );
    const [id, values] = codes.update.mock.calls[2] as [string, Where];
    expect(id).toBe('code-1');
    expect(values).toMatchObject({ is_verified: false });
    // The right guess is refunded, so a code given back on its last allowed
    // guess still works.
    expect((values.attempt_count as () => string)()).toBe(
      'GREATEST(attempt_count - 1, 0)',
    );
  });
});

describe('EmailAuthService checking add-email codes', () => {
  it("only accepts the requesting user's code", async () => {
    const { service, codes } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    const [{ where }] = codes.findOne.mock.calls[0] as [{ where: Where }];
    expect(where).toMatchObject({ user: { id: 'user-1' } });
  });

  it('saves the email, then puts it on Firebase', async () => {
    const { service, codes, firebase, users } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    expect(users.linkProvenEmail).toHaveBeenCalledWith('user-1', EMAIL);
    expect(firebase.setProvenEmail).toHaveBeenCalledWith('fb-1', EMAIL);
    // Firebase is written only after the backend has committed.
    expect(users.linkProvenEmail.mock.invocationCallOrder[0]).toBeLessThan(
      firebase.setProvenEmail.mock.invocationCallOrder[0],
    );
  });

  it('keeps the saved email when Firebase then fails', async () => {
    const { service, codes, firebase } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    firebase.setProvenEmail.mockRejectedValue(new Error('down'));
    await expect(
      service.verifyAddEmailCode('user-1', EMAIL, '123456'),
    ).resolves.toEqual({ state: true });
  });

  it("deletes a verified Firebase account nobody's bound to, then adds the email", async () => {
    const { service, codes, firebase, users, userRepo } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    firebase.findUserByEmail.mockResolvedValue(fbUser('orphan', true, []));
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    const [{ where }] = userRepo.exists.mock.calls[0] as [{ where: Where }];
    expect(where).toMatchObject({ firebase_uid: 'orphan' });
    expect(firebase.deleteUser).toHaveBeenCalledWith('orphan');
    expect(users.linkProvenEmail).toHaveBeenCalled();
    expect(firebase.setProvenEmail).toHaveBeenCalledWith('fb-1', EMAIL);
  });

  it('answers 409 when another account has the email verified on Firebase', async () => {
    const { service, codes, firebase, users, userRepo } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    firebase.findUserByEmail.mockResolvedValue(fbUser('other', true, []));
    userRepo.exists.mockResolvedValue(true);
    await expect(
      service.verifyAddEmailCode('user-1', EMAIL, '123456'),
    ).rejects.toThrow(ConflictException);
    expect(users.linkProvenEmail).not.toHaveBeenCalled();
  });

  it('frees the email from an unverified account that would be deleted anyway', async () => {
    const { service, codes, firebase, users, userRepo } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    firebase.findUserByEmail.mockResolvedValue(fbUser('other', false, []));
    userRepo.findOne.mockResolvedValue({
      id: 'b2',
      email: EMAIL,
      is_phone_verified: true,
    });
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    expect(firebase.deleteUser).toHaveBeenCalledWith('other');
    expect(users.linkProvenEmail).toHaveBeenCalled();
  });

  it("frees it even from an unverified account that is that email's own: never handed over", async () => {
    const { service, codes, firebase, users, userRepo } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    firebase.findUserByEmail.mockResolvedValue(
      fbUser('other', false, ['password']),
    );
    userRepo.findOne.mockResolvedValue({ id: 'b2', email: EMAIL });
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    expect(firebase.deleteUser).toHaveBeenCalledWith('other');
    expect(users.linkProvenEmail).toHaveBeenCalled();
  });

  it('adds the email to an account without a Firebase account yet', async () => {
    const { service, codes, firebase, users } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    users.assertCanLinkEmail.mockResolvedValue({ id: 'user-1' });
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    expect(firebase.setProvenEmail).not.toHaveBeenCalled();
    expect(users.linkProvenEmail).toHaveBeenCalled();
  });

  it("keeps a verified Firebase account nobody's bound to, for an account without one", async () => {
    // Its next email sign-in links that Firebase account to it.
    const { service, codes, firebase, users } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    users.assertCanLinkEmail.mockResolvedValue({ id: 'user-1' });
    firebase.findUserByEmail.mockResolvedValue(fbUser('orphan', true, []));
    await service.verifyAddEmailCode('user-1', EMAIL, '123456');
    expect(firebase.deleteUser).not.toHaveBeenCalled();
    expect(users.linkProvenEmail).toHaveBeenCalled();
  });

  it('refuses it too when another account has the email verified on Firebase', async () => {
    // Its first email sign-in would land in that other account instead.
    const { service, codes, firebase, users, userRepo } = setup();
    codes.findOne.mockResolvedValue(await storedCode('123456'));
    users.assertCanLinkEmail.mockResolvedValue({ id: 'user-1' });
    firebase.findUserByEmail.mockResolvedValue(fbUser('other', true, []));
    userRepo.exists.mockResolvedValue(true);
    await expect(
      service.verifyAddEmailCode('user-1', EMAIL, '123456'),
    ).rejects.toThrow(ConflictException);
    expect(users.linkProvenEmail).not.toHaveBeenCalled();
  });
});

describe('EmailAuthService: which Firebase account a proven email signs in to', () => {
  async function signIn(
    arrange: (ctx: ReturnType<typeof setup>) => void = () => {},
  ) {
    const ctx = setup();
    ctx.codes.findOne.mockResolvedValue(await storedCode('123456'));
    arrange(ctx);
    const { firebase_token } = await ctx.service.verifySignInCode(
      EMAIL,
      '123456',
    );
    return { ...ctx, token: firebase_token };
  }

  /** userRepo.findOne answers: the verified owner, then the holder's account. */
  const backend = (
    userRepo: ReturnType<typeof setup>['userRepo'],
    owner: object | null,
    account: object | null,
  ) =>
    userRepo.findOne
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(account);

  it("the backend owner's Firebase account first", async () => {
    const { token, userRepo, firebase } = await signIn(
      ({ userRepo, firebase }) => {
        backend(userRepo, { id: 'u1', firebase_uid: 'owner' }, null);
        firebase.findUser.mockResolvedValue(fbUser('owner', true, ['phone']));
      },
    );
    expect(token).toBe('token:owner');
    const [{ where }] = userRepo.findOne.mock.calls[0] as [{ where: Where }];
    expect(where).toMatchObject({ email: EMAIL, is_email_verified: true });
    expect(firebase.findUserByEmail).not.toHaveBeenCalled();
    expect(firebase.setProvenEmail).not.toHaveBeenCalled();
  });

  it("marks the email verified on the owner's account if Firebase has it unverified", async () => {
    const { token, firebase } = await signIn(({ userRepo, firebase }) => {
      backend(userRepo, { id: 'u1', firebase_uid: 'owner' }, null);
      firebase.findUser.mockResolvedValue(fbUser('owner', false, ['password']));
    });
    expect(token).toBe('token:owner');
    expect(firebase.setProvenEmail).toHaveBeenCalledWith('owner', EMAIL);
  });

  it("never changes a different email on the owner's Firebase account", async () => {
    const { token, firebase } = await signIn(({ userRepo, firebase }) => {
      backend(userRepo, { id: 'u1', firebase_uid: 'owner' }, null);
      firebase.findUser.mockResolvedValue({
        ...fbUser('owner', true, ['password']),
        email: 'other@example.com',
      });
    });
    expect(token).toBe('token:owner');
    expect(firebase.setProvenEmail).not.toHaveBeenCalled();
  });

  it("falls through when the owner's Firebase account is gone", async () => {
    const { token } = await signIn(({ userRepo, firebase }) => {
      backend(userRepo, { id: 'u1', firebase_uid: 'gone' }, null);
      firebase.findUserByEmail.mockResolvedValue(fbUser('held', true, []));
    });
    expect(token).toBe('token:held');
  });

  it('then the Firebase account holding it verified, untouched', async () => {
    const { token, firebase } = await signIn(({ firebase }) => {
      firebase.findUserByEmail.mockResolvedValue(
        fbUser('held', true, ['password']),
      );
    });
    expect(token).toBe('token:held');
    expect(firebase.deleteUser).not.toHaveBeenCalled();
    expect(firebase.createProvenEmailUser).not.toHaveBeenCalled();
  });

  describe('an account holding the email unverified', () => {
    const squatted = (providers = ['password']) =>
      fbUser('squatted', false, providers);

    it.each([
      ['no backend account behind it', null],
      ['a backend account plainly that email', { id: 'a1', email: EMAIL }],
      [
        'a backend account with another email',
        { id: 'a1', email: 'atk@example.com' },
      ],
      [
        'a banned backend account',
        { id: 'a1', email: EMAIL, account_status: 'banned' },
      ],
    ])('is always deleted, never handed over: %s', async (_, account) => {
      const { token, firebase } = await signIn(({ firebase, userRepo }) => {
        firebase.findUserByEmail.mockResolvedValue(
          squatted(['password', 'google.com']),
        );
        backend(userRepo, null, account);
      });
      expect(firebase.deleteUser).toHaveBeenCalledWith('squatted');
      expect(firebase.createCustomToken).not.toHaveBeenCalledWith('squatted');
      expect(firebase.createProvenEmailUser).toHaveBeenCalledWith(EMAIL);
      expect(token).toBe('token:fresh');
      // Deleted before the fresh account is created.
      expect(firebase.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(
        firebase.createProvenEmailUser.mock.invocationCallOrder[0],
      );
    });

    it('never changes the backend account behind it', async () => {
      const { userRepo } = await signIn(({ firebase, userRepo }) => {
        firebase.findUserByEmail.mockResolvedValue(squatted());
        backend(userRepo, null, { id: 'a1', email: EMAIL });
      });
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  it('creates a verified account when nobody holds the email', async () => {
    const { token, firebase } = await signIn();
    expect(firebase.createProvenEmailUser).toHaveBeenCalledWith(EMAIL);
    expect(token).toBe('token:fresh');
  });
});
