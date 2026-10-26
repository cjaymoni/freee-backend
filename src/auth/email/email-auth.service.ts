import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { In, IsNull, LessThan, MoreThan, Raw, Repository } from 'typeorm';
import type { auth as firebaseAuth } from 'firebase-admin';
import { FirebaseService } from '../../firebase/firebase.service';
import { MailService } from '../../mail/mail.service';
import { StaffInboxService } from '../../notification/staff-inbox.service';
import { accountSplitEntry } from '../../notification/staff-notices';
import { UserEntity } from '../../user/entities/user.entity';
import { UserService } from '../../user/user.service';
import { VerificationCodeEntity } from '../entities/verification-code.entity';

export type EmailProvider = 'firebase' | 'server';

export interface EmailConfig {
  /** Who sends sign-in emails first. */
  provider: EmailProvider;
  /** Where to turn when Firebase refuses to send (only while `provider` is `firebase`). */
  fallback: 'server' | null;
}

/** verification_codes.code_type values for this flow. */
const SIGN_IN = 'email_signin';
const ADD_EMAIL = 'email_link';

const CODE_TTL_MS = 10 * 60 * 1000;
/** Guesses allowed per code, the right one included. */
const MAX_ATTEMPTS = 5;
/** Tries at freeing an email and creating its Firebase account. */
const CREATE_ATTEMPTS = 3;
/**
 * Guesses allowed per email per day, across all its codes of either kind:
 * the bound on guessing, 30 in 900,000. Counted on guesses rather than codes
 * sent, so sending codes to an address alone can't shut it. Guessing can:
 * anyone who knows the address can spend its 30 and close email codes for it
 * for a day. Some per-address cap is the price of bounding guesses; the
 * Firebase link and phone sign-in still work meanwhile.
 */
const MAX_GUESSES_PER_DAY = 30;
/** Codes per email from one IP per hour, and per email per day (inbox flooding). */
const MAX_CODES_PER_IP_HOUR = 5;
const MAX_CODES_PER_DAY = 20;

/**
 * created_at is filled by the database clock, so windows on it are measured
 * by the same clock. Fixed strings, never user input.
 */
const withinLast = (interval: '60 seconds' | '1 hour' | '1 day') =>
  Raw((column) => `${column} > CURRENT_TIMESTAMP - INTERVAL '${interval}'`);

const EXPIRED = 'That code has expired. Send a new one.';

/**
 * Email codes sent by the backend over SMTP, the email counterpart of
 * SmsAuthService.
 *
 * Sign-in: a right code is traded for a Firebase custom token for the
 * account that owns the email, so the client signs in to the same Firebase
 * account and finishes through POST /auth/firebase-login.
 *
 * Add email: a signed-in user proves an email and it is saved as verified,
 * as POST /user/email does, and put on their Firebase account.
 */
@Injectable()
export class EmailAuthService {
  private readonly logger = new Logger(EmailAuthService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(VerificationCodeEntity)
    private readonly codes: Repository<VerificationCodeEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly mail: MailService,
    private readonly firebase: FirebaseService,
    private readonly users: UserService,
    private readonly staffInbox: StaffInboxService,
  ) {}

  getConfig(): EmailConfig {
    const provider = this.config.get<EmailProvider>(
      'EMAIL_PROVIDER',
      'firebase',
    );
    if (provider === 'server') return { provider: 'server', fallback: null };
    const fallbackOn = this.config.get<boolean>('EMAIL_FALLBACK_ENABLED', true);
    return { provider: 'firebase', fallback: fallbackOn ? 'server' : null };
  }

  async sendSignInCode(email: string, ip: string): Promise<void> {
    this.assertSignInCodesOn();
    await this.issue(SIGN_IN, email, ip);
  }

  async verifySignInCode(email: string, code: string) {
    this.assertSignInCodesOn();
    return this.consume(SIGN_IN, email, code, undefined, async () => ({
      firebase_token: await this.firebaseTokenFor(email),
    }));
  }

  /**
   * The Firebase account a proven email signs in to:
   *
   * 1. The one bound to the backend account that already has the email
   *    verified, so one person isn't split across two Firebase accounts.
   * 2. Otherwise the Firebase account holding the email verified.
   * 3. Otherwise a new Firebase account with the email verified. One that
   *    held the email unverified is deleted first (see
   *    deleteUnverifiedHolder), never handed over.
   */
  private async firebaseTokenFor(email: string): Promise<string> {
    const owner = await this.userRepo.findOne({
      where: { email, is_email_verified: true, is_deleted: false },
    });
    if (owner?.firebase_uid) {
      const bound = await this.firebase.findUser(owner.firebase_uid);
      if (bound) {
        // Only fill it in: a different email there is that account's
        // password sign-in, not ours to change.
        if (!bound.email || (bound.email === email && !bound.emailVerified)) {
          await this.firebase
            .setProvenEmail(bound.uid, email)
            .catch((error) =>
              this.logger.warn(
                `Couldn't put the proven email on its bound Firebase account: ${String(error)}`,
              ),
            );
        }
        return this.firebase.createCustomToken(bound.uid);
      }
    }

    // Whoever made the unverified account can recreate it in the moment
    // between the delete and the create; delete it again, a few times.
    for (let attempt = 1; ; attempt++) {
      const holder = await this.firebase.findUserByEmail(email);
      if (holder?.emailVerified) {
        return this.firebase.createCustomToken(holder.uid);
      }
      if (holder) await this.deleteUnverifiedHolder(holder);
      try {
        const created = await this.firebase.createProvenEmailUser(email);
        return this.firebase.createCustomToken(created.uid);
      } catch (error) {
        const taken =
          (error as { code?: string }).code === 'auth/email-already-exists';
        if (!taken || attempt >= CREATE_ATTEMPTS) throw error;
        this.logger.warn(
          `An unverified Firebase account reappeared for a proven email (attempt ${attempt}); deleting it again`,
        );
      }
    }
  }

  /**
   * Delete a Firebase account that holds an email unverified, to free the
   * email for whoever proved it. Anyone could have created it with someone
   * else's address, set a password, linked their own phone or Google, and
   * built a backend account behind it, so it is never handed over: a login,
   * a token refresh or a Firebase sign-in already under way could leave its
   * creator a way back in. Firebase can't take an email off an account, so
   * it is deleted.
   *
   * Its backend account, if any, keeps its data, phone and current sessions,
   * but loses the email (resolveFirebaseLink) and with it its Firebase
   * sign-in and its password sign-in, which goes by email. If it was the
   * prover's own (a sign-up whose email was never verified), they now have
   * two accounts, so staff get an inbox entry linking to the old one and
   * naming the email, which finds the new one.
   */
  private async deleteUnverifiedHolder(holder: firebaseAuth.UserRecord) {
    const account = await this.userRepo.findOne({
      where: { firebase_uid: holder.uid, is_deleted: false },
    });
    await this.firebase.deleteUser(holder.uid);
    if (account) {
      this.logger.warn(
        `Proven email freed from an unverified Firebase account bound to backend account ${account.id} (${account.account_status})`,
      );
      void this.staffInbox.toAllStaff(
        accountSplitEntry(account.id, holder.email ?? ''),
      );
    }
  }

  async sendAddEmailCode(userId: string, email: string, ip: string) {
    const user = await this.users.assertCanLinkEmail(userId, email);
    await this.freeOnFirebase(user, email, { checkOnly: true });
    await this.issue(ADD_EMAIL, email, ip, userId);
  }

  async verifyAddEmailCode(userId: string, email: string, code: string) {
    return this.consume(ADD_EMAIL, email, code, userId, async () => {
      const user = await this.users.assertCanLinkEmail(userId, email);
      await this.freeOnFirebase(user, email);
      const saved = await this.users.linkProvenEmail(userId, email);
      // After the commit, so a failed commit can't leave the email on
      // Firebase only. If this fails the backend already has it verified,
      // and the next email-code sign-in puts it on this Firebase account.
      if (user.firebase_uid) {
        await this.firebase
          .setProvenEmail(user.firebase_uid, email)
          .catch((error) =>
            this.logger.warn(
              `Added email saved, but not on Firebase yet: ${String(error)}`,
            ),
          );
      }
      return saved;
    });
  }

  /**
   * Make room on Firebase for `user` to take a proven email, or refuse with
   * 409 (`checkOnly`: refuse, but delete nothing):
   *
   * - held verified by a Firebase account another backend account is bound
   *   to: refused, the accounts can't be merged here;
   * - held verified by one nobody is bound to (left by a sign-in that never
   *   finished): kept for a user without a Firebase account yet, whose next
   *   email sign-in links to it; otherwise deleted, so the email can go on
   *   the user's own Firebase account;
   * - held unverified: deleted, as on sign-in (deleteUnverifiedHolder).
   *
   * Deletes happen before the email is saved and can't be undone; if saving
   * then fails (another account claimed the email meanwhile), the deleted
   * account was one that would have been deleted anyway.
   */
  private async freeOnFirebase(
    user: UserEntity,
    email: string,
    { checkOnly = false } = {},
  ) {
    const holder = await this.firebase.findUserByEmail(email);
    if (!holder || holder.uid === user.firebase_uid) return;
    if (!holder.emailVerified) {
      if (!checkOnly) await this.deleteUnverifiedHolder(holder);
      return;
    }
    const bound = await this.userRepo.exists({
      where: { firebase_uid: holder.uid, is_deleted: false },
    });
    if (bound) {
      throw new ConflictException(
        'This email already has its own account. Sign in with it using an email code instead.',
      );
    }
    if (user.firebase_uid && !checkOnly) {
      await this.firebase.deleteUser(holder.uid);
    }
  }

  private assertSignInCodesOn() {
    const { provider, fallback } = this.getConfig();
    if (provider !== 'server' && !fallback) {
      throw new ServiceUnavailableException(
        'Email codes from the server are switched off.',
      );
    }
  }

  private async issue(
    type: string,
    email: string,
    ip: string,
    userId?: string,
  ): Promise<void> {
    // An add-email code belongs to the user who asked; another user asking
    // for the same address must not hold it up or cancel it.
    const mine = {
      email,
      code_type: type,
      user: userId ? { id: userId } : IsNull(),
    };

    if (
      await this.codes.exists({
        where: {
          ...mine,
          is_verified: false,
          created_at: withinLast('60 seconds'),
        },
      })
    ) {
      throw new HttpException(
        'Wait a minute before asking for another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [fromThisIp, forThisEmail] = await Promise.all([
      this.codes.count({
        where: {
          email,
          code_type: type,
          ip_address: ip,
          created_at: withinLast('1 hour'),
        },
      }),
      this.codes.count({
        where: { email, code_type: type, created_at: withinLast('1 day') },
      }),
    ]);
    if (
      fromThisIp >= MAX_CODES_PER_IP_HOUR ||
      forThisEmail >= MAX_CODES_PER_DAY
    ) {
      throw new HttpException(
        'Too many codes for this email. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Only the newest code works.
    await this.codes.update(
      { ...mine, is_verified: false },
      { expires_at: new Date() },
    );

    const code = randomInt(100000, 1000000).toString();
    const row = await this.codes.save(
      this.codes.create({
        email,
        code_type: type,
        code_hash: await bcrypt.hash(code, await bcrypt.genSalt()),
        expires_at: new Date(Date.now() + CODE_TTL_MS),
        ip_address: ip,
        ...(userId && { user: { id: userId } }),
      }),
    );

    try {
      await this.mail.sendEmailCode(
        email,
        code,
        type === SIGN_IN ? 'sign-in' : 'add-email',
      );
    } catch {
      // Nothing was sent, so it mustn't count toward any limit.
      await this.codes.delete(row.id);
      throw new ServiceUnavailableException(
        "We couldn't send the email. Try again shortly.",
      );
    }
  }

  /**
   * Accept the newest code once and run `then`. If `then` fails, the code
   * is given back, so a passing Firebase hiccup doesn't cost the user a
   * fresh code and a minute's wait; the guess it used still counts.
   */
  private async consume<T>(
    type: string,
    email: string,
    code: string,
    userId: string | undefined,
    then: () => Promise<T>,
  ): Promise<T> {
    const row = await this.codes.findOne({
      where: {
        email,
        code_type: type,
        is_verified: false,
        // A code to add an email only works for the user who asked for it.
        user: userId ? { id: userId } : IsNull(),
      },
      order: { created_at: 'DESC' },
    });
    if (!row) throw new BadRequestException(EXPIRED);

    // Across sign-in and add-email codes alike: either one won gives the
    // email away. Not password-reset or verification codes, which anyone can
    // set off for an address. Right guesses count too; nobody needs 30 a day.
    const guessedToday = await this.codes.sum('attempt_count', {
      email,
      code_type: In([SIGN_IN, ADD_EMAIL]),
      created_at: withinLast('1 day'),
    });
    if ((guessedToday ?? 0) >= MAX_GUESSES_PER_DAY) {
      throw new HttpException(
        'Too many attempts for this email. Try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Count the guess before checking it, and only while guesses remain, in
    // one statement: concurrent guesses can't all slip in under the limit.
    const counted = await this.codes.update(
      {
        id: row.id,
        is_verified: false,
        attempt_count: LessThan(MAX_ATTEMPTS),
        expires_at: MoreThan(new Date()),
      },
      { attempt_count: () => 'attempt_count + 1' },
    );
    if (!counted.affected) throw new BadRequestException(EXPIRED);

    if (!(await bcrypt.compare(code, row.code_hash))) {
      throw new BadRequestException("That code isn't right.");
    }

    // Conditional, so two requests racing with the same code can't both win.
    const used = await this.codes.update(
      { id: row.id, is_verified: false },
      { is_verified: true, verified_at: new Date() },
    );
    if (!used.affected) throw new BadRequestException(EXPIRED);
    this.logger.log(`Email code accepted (${type})`);

    try {
      return await then();
    } catch (error) {
      // The right guess is refunded too, or a code given back on its last
      // allowed guess could never be used again.
      await this.codes.update(row.id, {
        is_verified: false,
        verified_at: null as unknown as Date,
        attempt_count: () => 'GREATEST(attempt_count - 1, 0)',
      });
      throw error;
    }
  }
}
