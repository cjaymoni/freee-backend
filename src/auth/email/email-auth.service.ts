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
import { ChatRealtimeService } from '../../chat/chat-realtime.service';
import { FirebaseService } from '../../firebase/firebase.service';
import { MailService } from '../../mail/mail.service';
import { AccountStatus, UserEntity } from '../../user/entities/user.entity';
import { UserService } from '../../user/user.service';
import { UserSessionEntity } from '../entities/user-session.entity';
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
/** Wrong guesses allowed per code. */
const MAX_ATTEMPTS = 5;
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
    @InjectRepository(UserSessionEntity)
    private readonly sessions: Repository<UserSessionEntity>,
    private readonly mail: MailService,
    private readonly firebase: FirebaseService,
    private readonly users: UserService,
    private readonly chatRealtime: ChatRealtimeService,
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
   * 3. Otherwise one holding it unverified, which anyone could have created
   *    with someone else's address: handed over or deleted, see
   *    unverifiedHolderFate.
   * 4. Otherwise a new Firebase account with the email verified.
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

    let holder = await this.firebase.findUserByEmail(email);
    if (holder && !holder.emailVerified) {
      const fate = await this.unverifiedHolderFate(holder, email);
      if (fate.handOver) {
        await this.handOver(holder.uid, fate.account, email);
      } else {
        await this.firebase.deleteUser(holder.uid);
        holder = null;
      }
    }
    holder ??= await this.firebase.createProvenEmailUser(email);
    return this.firebase.createCustomToken(holder.uid);
  }

  /**
   * What happens to a Firebase account holding a proven email unverified.
   * Anyone could have created it with someone else's address, set a
   * password, linked their own Google or phone, and built a backend account
   * behind it. It is handed over to the prover only when its backend
   * account is plainly that email's: it has the email, and no verified
   * phone. Otherwise the prover gets a fresh account and it is deleted
   * (Firebase can't take an email off an account):
   *
   * - no backend account: nothing to keep;
   * - a verified phone: its owner signs back in with it and lands in their
   *   backend account again (resolveFirebaseLink);
   * - a different email, or none: that account isn't this email's, whatever
   *   it holds. Handing it over would leave its creator a way back in
   *   through that other email (a password reset), and it is never another
   *   account's that has this email verified;
   * - suspended or banned: the prover would inherit that status.
   *
   * Firebase sign-in methods don't count as a way back: after a delete they
   * would start a new account, not reach the old one.
   */
  private async unverifiedHolderFate(
    holder: firebaseAuth.UserRecord,
    email: string,
  ): Promise<{ handOver: true; account: UserEntity } | { handOver: false }> {
    const account = await this.userRepo.findOne({
      where: { firebase_uid: holder.uid, is_deleted: false },
    });
    if (!account || account.is_phone_verified || account.email !== email) {
      return { handOver: false };
    }
    // A banned or suspended account would pass its status to the person who
    // proved the email, and tie the email to it for good. Deleting instead
    // lets that person start a clean account, which is also how a banned
    // user who never verified their email could start over: logged, so
    // staff can see it.
    if (account.account_status !== AccountStatus.ACTIVE) {
      this.logger.warn(
        `Email-code sign-in for ${account.account_status} account ${account.id}'s unverified email: its Firebase account is deleted, not handed over`,
      );
      return { handOver: false };
    }
    return { handOver: true, account };
  }

  /**
   * Hand a Firebase account and its backend account to whoever proved the
   * email, leaving whoever created them nothing: Firebase password, other
   * sign-in methods and sessions; then the backend password, sessions and
   * open sockets; and only then the email marked verified, which is what
   * makes a retry treat it as done. If any step fails, the code is given
   * back and a retry redoes them all.
   */
  private async handOver(
    firebaseUid: string,
    account: UserEntity,
    email: string,
  ) {
    await this.firebase.lockOutForAdoption(firebaseUid);
    // Sessions first, so whoever created it can't change the account (say,
    // to another email they could reset) while it is handed over.
    await this.endSessions(account);
    // The password could have been set during onboarding; the reset channel
    // is now the proven email alone. Only while the account still has that
    // email: if it changed since it was checked, stop. The code is given
    // back, and the retry sees the new email and deletes instead.
    const claimed = await this.userRepo.update(
      { id: account.id, email },
      { password_hash: null as unknown as string, is_email_verified: true },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        'This account changed while signing in. Please try again.',
      );
    }
    await this.firebase.markEmailVerified(firebaseUid);
    // Again, for a sign-in that was already past its token check when the
    // Firebase sessions were revoked and saved its session since.
    await this.endSessions(account);
  }

  private async endSessions(account: UserEntity) {
    await this.sessions.update(
      { user: { id: account.id }, is_active: true },
      { is_active: false },
    );
    await this.users.clearUserCache(account);
    // Sockets are only checked when they connect.
    this.chatRealtime.disconnectUser(account.id);
  }

  async sendAddEmailCode(userId: string, email: string, ip: string) {
    const user = await this.users.assertCanLinkEmail(userId, email);
    await this.freeOnFirebase(user, email, { checkOnly: true });
    await this.issue(ADD_EMAIL, email, ip, userId);
  }

  async verifyAddEmailCode(
    userId: string,
    email: string,
    code: string,
    sessionToken?: string,
  ) {
    return this.consume(ADD_EMAIL, email, code, userId, async () => {
      const user = await this.users.assertCanLinkEmail(userId, email);
      await this.freeOnFirebase(user, email);
      const saved = await this.users.linkProvenEmail(
        userId,
        email,
        sessionToken,
      );
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
   * - held unverified: deleted when unverifiedHolderFate says so; refused
   *   when it would be handed over, since it is that email's own account and
   *   signing in with an email code hands it over.
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
    const refuse = () =>
      new ConflictException(
        'This email already has its own account. Sign in with it using an email code instead.',
      );

    if (holder.emailVerified) {
      const bound = await this.userRepo.exists({
        where: { firebase_uid: holder.uid, is_deleted: false },
      });
      if (bound) throw refuse();
      if (!user.firebase_uid) return;
    } else if ((await this.unverifiedHolderFate(holder, email)).handOver) {
      throw refuse();
    }
    if (!checkOnly) await this.firebase.deleteUser(holder.uid);
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
