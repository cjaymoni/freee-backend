import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwilioVerifyClient, TwilioVerifyError } from './twilio-verify.client';

const PHONE = '+233241234567';
const CREDENTIALS: Record<string, string> = {
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'secret',
  TWILIO_VERIFY_SERVICE_SID: 'VA123',
};

function client(env = CREDENTIALS) {
  return new TwilioVerifyClient({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
}

const fetchMock = jest.fn();
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      body === undefined
        ? Promise.reject(new SyntaxError('not json'))
        : Promise.resolve(body),
  });

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(() => fetchMock.mockReset());

const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (e: unknown) => (e instanceof TwilioVerifyError ? e.reason : String(e)),
  );

describe('TwilioVerifyClient', () => {
  it('posts the number to the Verify service with basic auth', async () => {
    reply(201, { status: 'pending' });
    await client().sendCode(PHONE);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://verify.twilio.com/v2/Services/VA123/Verifications',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
    );
    expect((init.body as URLSearchParams).toString()).toBe(
      new URLSearchParams({ To: PHONE, Channel: 'sms' }).toString(),
    );
  });

  it('approves a right code and not a wrong one', async () => {
    reply(200, { status: 'approved' });
    await expect(client().checkCode(PHONE, '123456')).resolves.toBe(true);
    // Twilio answers a wrong code with 200 and status pending.
    reply(200, { status: 'pending' });
    await expect(client().checkCode(PHONE, '000000')).resolves.toBe(false);
  });

  it.each([
    [404, { code: 20404 }, 'no-pending-code'],
    [429, { code: 60202 }, 'rate-limited'],
    [429, { code: 60203 }, 'rate-limited'],
    [400, { code: 60200 }, 'invalid-number'],
    [403, { code: 60410 }, 'blocked'],
    [403, { code: 60605 }, 'blocked'],
    [429, {}, 'rate-limited'],
    [500, undefined, 'unavailable'],
  ])('maps HTTP %i %j to %s', async (status, body, expected) => {
    reply(status, body);
    await expect(reason(client().checkCode(PHONE, '123456'))).resolves.toBe(
      expected,
    );
  });

  it('reports a network failure or timeout as unavailable', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(reason(client().sendCode(PHONE))).resolves.toBe('unavailable');
  });

  it("doesn't call Twilio when it isn't configured", async () => {
    await expect(
      reason(client({ TWILIO_ACCOUNT_SID: 'AC123' }).sendCode(PHONE)),
    ).resolves.toBe('not-configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never logs Twilio's message, which can quote the number", async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    reply(400, { code: 60200, message: `Invalid parameter To: ${PHONE}` });
    await reason(client().sendCode(PHONE));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PHONE);
    warn.mockRestore();
  });
});
