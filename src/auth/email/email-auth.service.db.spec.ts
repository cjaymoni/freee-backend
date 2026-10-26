import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  describeWithDatabase,
  testDatabaseFor,
} from '../../common/testing/test-database';
import { FirebaseService } from '../../firebase/firebase.service';
import { MailService } from '../../mail/mail.service';
import { UserEntity } from '../../user/entities/user.entity';
import { UserService } from '../../user/user.service';
import { VerificationCodeEntity } from '../entities/verification-code.entity';
import { EmailAuthService } from './email-auth.service';

/**
 * Email codes against a real Postgres: the conditional updates that count
 * guesses and use a code once, and the limits measured on created_at. The
 * unit spec covers the decisions; this covers the SQL. See common/testing.
 */
describeWithDatabase('EmailAuthService codes on Postgres', () => {
  let ds: DataSource;
  let service: EmailAuthService;
  const mail = { sendEmailCode: jest.fn() };
  const firebase = {
    findUser: jest.fn().mockResolvedValue(null),
    findUserByEmail: jest.fn().mockResolvedValue(null),
    createProvenEmailUser: jest.fn().mockResolvedValue({ uid: 'fresh' }),
    createCustomToken: jest.fn().mockResolvedValue('custom-token'),
  };
  let n = 0;
  /** A fresh address per test, so limits don't carry over. */
  const nextEmail = () => `ama${++n}@example.com`;

  /** Send a code and return what was emailed. */
  const send = async (email: string, ip = '1.1.1.1') => {
    mail.sendEmailCode.mockClear();
    await service.sendSignInCode(email, ip);
    return (mail.sendEmailCode.mock.calls[0] as [string, string])[1];
  };
  const codesFor = (email: string) =>
    ds.getRepository(VerificationCodeEntity).find({ where: { email } });
  /** Make the codes for `email` older, as if sent `seconds` ago. */
  const age = (email: string, seconds: number) =>
    ds.query(
      `UPDATE verification_codes
         SET created_at = created_at - make_interval(secs => $2)
       WHERE email = $1`,
      [email, seconds],
    );
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url: await testDatabaseFor('email_auth'),
      entities: [join(__dirname, '..', '..', '**', '*.entity.ts')],
      synchronize: true,
      dropSchema: true,
      logging: false,
    }).initialize();
    service = new EmailAuthService(
      { get: (_: string, fallback?: unknown) => fallback } as ConfigService,
      ds.getRepository(VerificationCodeEntity),
      ds.getRepository(UserEntity),
      mail as unknown as MailService,
      firebase as unknown as FirebaseService,
      { clearUserCache: jest.fn() } as unknown as UserService,
    );
  });

  beforeEach(() => mail.sendEmailCode.mockResolvedValue(undefined));

  afterAll(async () => {
    await ds?.destroy();
  });

  it('accepts the right code once', async () => {
    const email = nextEmail();
    const code = await send(email);
    await expect(service.verifySignInCode(email, code)).resolves.toEqual({
      firebase_token: 'custom-token',
    });
    await expect(service.verifySignInCode(email, code)).rejects.toThrow(
      'That code has expired. Send a new one.',
    );
  });

  it('refuses even the right code after 5 wrong guesses', async () => {
    const email = nextEmail();
    const code = await send(email);
    for (let i = 0; i < 5; i++) {
      await expect(
        service.verifySignInCode(email, wrong(code)),
      ).rejects.toThrow("That code isn't right.");
    }
    await expect(service.verifySignInCode(email, code)).rejects.toThrow(
      'That code has expired. Send a new one.',
    );
    const [row] = await codesFor(email);
    expect(row.attempt_count).toBe(5);
  });

  it('counts concurrent wrong guesses without going over the limit', async () => {
    const email = nextEmail();
    const code = await send(email);
    await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        service.verifySignInCode(email, wrong(code)),
      ),
    );
    const [row] = await codesFor(email);
    expect(row.attempt_count).toBe(5);
    await expect(service.verifySignInCode(email, code)).rejects.toThrow(
      'That code has expired. Send a new one.',
    );
  });

  it('refuses an expired code', async () => {
    const email = nextEmail();
    const code = await send(email);
    await ds.query(
      `UPDATE verification_codes SET expires_at = $2 WHERE email = $1`,
      [email, new Date(Date.now() - 1000)],
    );
    await expect(service.verifySignInCode(email, code)).rejects.toThrow(
      'That code has expired. Send a new one.',
    );
  });

  it('gives a code back when the step after it fails', async () => {
    const email = nextEmail();
    const code = await send(email);
    firebase.createProvenEmailUser.mockRejectedValueOnce(new Error('down'));
    await expect(service.verifySignInCode(email, code)).rejects.toThrow('down');
    const [row] = await codesFor(email);
    expect(row.is_verified).toBe(false);
    await expect(service.verifySignInCode(email, code)).resolves.toEqual({
      firebase_token: 'custom-token',
    });
  });

  it('still accepts a code given back on its last allowed guess', async () => {
    const email = nextEmail();
    const code = await send(email);
    for (let i = 0; i < 4; i++) {
      await expect(
        service.verifySignInCode(email, wrong(code)),
      ).rejects.toThrow("That code isn't right.");
    }
    firebase.createProvenEmailUser.mockRejectedValueOnce(new Error('down'));
    await expect(service.verifySignInCode(email, code)).rejects.toThrow('down');
    await expect(service.verifySignInCode(email, code)).resolves.toEqual({
      firebase_token: 'custom-token',
    });
  });

  it('counts guesses across sign-in and add-email codes', async () => {
    const email = nextEmail();
    await ds.getRepository(VerificationCodeEntity).save({
      email,
      code_type: 'email_link',
      code_hash: 'x',
      attempt_count: 30,
      expires_at: new Date(Date.now() - 1000),
    });
    const code = await send(email);
    await expect(service.verifySignInCode(email, code)).rejects.toThrow(
      'Too many attempts for this email',
    );
  });

  it('only the newest code works', async () => {
    const email = nextEmail();
    const first = await send(email);
    await age(email, 61);
    const second = await send(email);
    await expect(service.verifySignInCode(email, first)).rejects.toThrow();
    await expect(
      service.verifySignInCode(email, second),
    ).resolves.toBeDefined();
  });

  it('waits a minute between codes, by the database clock', async () => {
    const email = nextEmail();
    await send(email);
    await expect(service.sendSignInCode(email, '1.1.1.1')).rejects.toThrow(
      'Wait a minute',
    );
    await age(email, 61);
    await expect(send(email)).resolves.toMatch(/^\d{6}$/);
  });

  it('caps codes per email per IP per hour, not other IPs', async () => {
    const email = nextEmail();
    for (let i = 0; i < 5; i++) {
      await send(email, '2.2.2.2');
      await age(email, 61);
    }
    await expect(service.sendSignInCode(email, '2.2.2.2')).rejects.toThrow(
      'Too many codes',
    );
    await expect(send(email, '3.3.3.3')).resolves.toMatch(/^\d{6}$/);
  });

  it("doesn't count a code whose email failed to send", async () => {
    const email = nextEmail();
    mail.sendEmailCode.mockRejectedValueOnce(new Error('smtp down'));
    await expect(service.sendSignInCode(email, '1.1.1.1')).rejects.toThrow(
      "We couldn't send the email",
    );
    expect(await codesFor(email)).toHaveLength(0);
    // And no minute's wait for a code that never arrived.
    await expect(send(email)).resolves.toMatch(/^\d{6}$/);
  });

  it('stops checking codes for an email after 30 wrong guesses in a day', async () => {
    const email = nextEmail();
    await send(email);
    await ds.query(
      `UPDATE verification_codes SET attempt_count = 30 WHERE email = $1`,
      [email],
    );
    await age(email, 61);
    const code = await send(email);
    await expect(service.verifySignInCode(email, code)).rejects.toThrow(
      'Too many attempts for this email',
    );
  });
});
