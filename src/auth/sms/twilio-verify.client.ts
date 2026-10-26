import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Why Twilio refused; the caller turns it into an HTTP answer. */
export type TwilioFailure =
  | 'not-configured'
  | 'invalid-number'
  | 'rate-limited'
  | 'blocked'
  | 'no-pending-code'
  | 'unavailable';

export class TwilioVerifyError extends Error {
  constructor(
    readonly reason: TwilioFailure,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

// https://www.twilio.com/docs/api/errors
const REASONS: Record<number, TwilioFailure> = {
  20404: 'no-pending-code', // expired, already approved, or out of checks
  21211: 'invalid-number',
  21614: 'invalid-number',
  60200: 'invalid-number',
  60202: 'rate-limited', // too many checks for this verification
  60203: 'rate-limited', // too many sends to this number
  60410: 'blocked', // Fraud Guard
  60605: 'blocked', // country not enabled in Verify geo permissions
};

/**
 * Twilio Verify over its REST API. Twilio generates, sends, expires and
 * checks the codes, and limits sends and checks per number, so nothing is
 * stored here.
 */
@Injectable()
export class TwilioVerifyClient {
  private readonly logger = new Logger(TwilioVerifyClient.name);
  private readonly baseUrl = 'https://verify.twilio.com/v2/Services';

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!(
      this.config.get<string>('TWILIO_ACCOUNT_SID') &&
      this.config.get<string>('TWILIO_AUTH_TOKEN') &&
      this.config.get<string>('TWILIO_VERIFY_SERVICE_SID')
    );
  }

  async sendCode(phone: string): Promise<void> {
    await this.post('Verifications', { To: phone, Channel: 'sms' });
  }

  /** True when the code is right; false when it is wrong but may be retried. */
  async checkCode(phone: string, code: string): Promise<boolean> {
    const body = await this.post('VerificationCheck', {
      To: phone,
      Code: code,
    });
    return body.status === 'approved';
  }

  private async post(
    path: string,
    form: Record<string, string>,
  ): Promise<{ status?: string }> {
    if (!this.configured) throw new TwilioVerifyError('not-configured');

    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID')!;
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN')!;
    const service = this.config.get<string>('TWILIO_VERIFY_SERVICE_SID')!;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/${service}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(`Twilio ${path} unreachable: ${String(error)}`);
      throw new TwilioVerifyError('unavailable');
    }

    const body = (await res.json().catch(() => ({}))) as {
      status?: string | number;
      code?: number;
      message?: string;
    };
    if (res.ok) return body as { status?: string };

    const reason =
      (body.code && REASONS[body.code]) ||
      (res.status === 429 ? 'rate-limited' : 'unavailable');
    // Not Twilio's message: it can quote the number back.
    this.logger.warn(
      `Twilio ${path} failed: HTTP ${res.status} code ${body.code ?? '-'}`,
    );
    throw new TwilioVerifyError(reason, body.message);
  }
}
