import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FirebaseService } from '../../firebase/firebase.service';
import { UserEntity } from '../../user/entities/user.entity';
import {
  TwilioFailure,
  TwilioVerifyClient,
  TwilioVerifyError,
} from './twilio-verify.client';

export type SmsProvider = 'firebase' | 'twilio';

export interface SmsConfig {
  /** Who sends the code first. */
  provider: SmsProvider;
  /**
   * The backend sender to use when Firebase refuses to send (only set while
   * `provider` is `firebase`), or null for no fallback.
   */
  fallback: 'twilio' | null;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Phone sign-in codes sent by the backend instead of Firebase. A verified
 * code is traded for a Firebase custom token, so the client still ends up
 * signed in to the same Firebase account and finishes through
 * POST /auth/firebase-login exactly as with Firebase phone auth.
 */
@Injectable()
export class SmsAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly twilio: TwilioVerifyClient,
    private readonly firebase: FirebaseService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  getConfig(): SmsConfig {
    const provider = this.config.get<SmsProvider>('SMS_PROVIDER', 'firebase');
    // Only offer Twilio when it can actually send; otherwise clients would
    // switch to a path that always fails.
    const twilioReady = this.twilio.configured;
    if (provider === 'twilio' && twilioReady) {
      return { provider: 'twilio', fallback: null };
    }
    const fallbackOn = this.config.get<boolean>('SMS_FALLBACK_ENABLED', true);
    return {
      provider: 'firebase',
      fallback: fallbackOn && twilioReady ? 'twilio' : null,
    };
  }

  async sendCode(phone: string): Promise<void> {
    this.assertBackendSmsAllowed();
    this.assertAllowedNumber(phone);
    try {
      await this.twilio.sendCode(phone);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async verifyCode(phone: string, code: string) {
    this.assertBackendSmsAllowed();
    this.assertAllowedNumber(phone);
    let approved: boolean;
    try {
      approved = await this.twilio.checkCode(phone, code);
    } catch (error) {
      throw this.toHttp(error);
    }
    if (!approved) {
      throw new BadRequestException("That code isn't right.");
    }
    // The backend account that has proven this number decides which
    // Firebase account it signs in to, so one person isn't split across two.
    const owner = await this.userRepo.findOne({
      where: {
        phone_number: phone,
        is_phone_verified: true,
        is_deleted: false,
      },
    });
    return {
      firebase_token: await this.firebase.customTokenForPhone(
        phone,
        owner?.firebase_uid ?? undefined,
      ),
    };
  }

  /** The backend only texts while some client is meant to use it. */
  private assertBackendSmsAllowed() {
    const { provider, fallback } = this.getConfig();
    if (provider !== 'twilio' && !fallback) {
      throw new ServiceUnavailableException(
        'Phone codes from the server are switched off.',
      );
    }
  }

  private assertAllowedNumber(phone: string) {
    if (!E164.test(phone)) {
      throw new BadRequestException('Enter a valid phone number.');
    }
    const prefixes = this.config
      .get<string>('SMS_ALLOWED_PREFIXES', '+233')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!prefixes.some((p) => phone.startsWith(p))) {
      throw new BadRequestException(
        "Phone sign-in isn't available for this country.",
      );
    }
  }

  private toHttp(error: unknown): HttpException {
    if (!(error instanceof TwilioVerifyError)) {
      return new ServiceUnavailableException(
        "We couldn't send the code. Try again shortly.",
      );
    }
    const answers: Record<TwilioFailure, [string, number]> = {
      'invalid-number': ['Enter a valid phone number.', HttpStatus.BAD_REQUEST],
      'rate-limited': [
        'Too many attempts. Wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      ],
      blocked: ["We can't send a code to this number.", HttpStatus.BAD_REQUEST],
      'no-pending-code': [
        'That code has expired. Send a new one.',
        HttpStatus.BAD_REQUEST,
      ],
      'not-configured': [
        'Phone codes from the server are switched off.',
        HttpStatus.SERVICE_UNAVAILABLE,
      ],
      unavailable: [
        "We couldn't send the code. Try again shortly.",
        HttpStatus.SERVICE_UNAVAILABLE,
      ],
    };
    const [message, status] = answers[error.reason];
    return new HttpException(message, status);
  }
}
