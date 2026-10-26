import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { randomBytes } from 'crypto';

const isNotFound = (error: unknown) =>
  (error as { code?: string }).code === 'auth/user-not-found';

/** The user `lookup` finds, or null if there is none. */
async function orNull(
  lookup: Promise<admin.auth.UserRecord>,
): Promise<admin.auth.UserRecord | null> {
  try {
    return await lookup;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** setProvenEmail: another Firebase account already has this email. */
export class EmailHeldByOtherFirebaseUser extends Error {
  constructor() {
    super('Email belongs to another Firebase account');
  }
}

/** FCM errors that always mean the token itself is dead. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Errors that mean a bad token only if another token in the same send got
 * through; otherwise they point at the payload or the credentials.
 */
const DEAD_IF_OTHERS_SENT = new Set([
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );
    const serviceAccountJson = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );

    const credentialSource = serviceAccountJson || serviceAccountPath;

    if (!credentialSource) {
      this.logger.warn(
        'Firebase credentials not found. Firebase features will be unavailable.',
      );
      return;
    }

    try {
      const credential = this.tryParseCredential(credentialSource);

      if (typeof credential === 'string') {
        // If it's still a string, it must be a path
        this.logger.log(`Firebase: Initializing via path: ${credential}`);
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(credential),
        });
      } else if (typeof credential === 'object' && credential !== null) {
        // If it's an object, it's the parsed JSON
        this.logger.log('Firebase: Initializing via parsed JSON object');

        const serviceAccount = credential;
        // Fix private key formatting
        if (serviceAccount.privateKey) {
          serviceAccount.privateKey = serviceAccount.privateKey.replace(
            /\\n/g,
            '\n',
          );
        }

        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }

      this.logger.log('Firebase Admin initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
  }

  private tryParseCredential(input: string): string | admin.ServiceAccount {
    let current: any = input.trim();

    // Remove surrounding quotes if Render/Docker wrapped the whole thing
    if (
      typeof current === 'string' &&
      current.startsWith('"') &&
      current.endsWith('"') &&
      current.length > 2
    ) {
      current = current.substring(1, current.length - 1).trim();
    }

    // Attempt recursive parsing for double-encoded JSON
    while (typeof current === 'string' && current.startsWith('{')) {
      try {
        const parsed = JSON.parse(current);
        // If it's a string, keep going. If it's an object, we're done.
        if (typeof parsed === 'string') {
          current = parsed.trim();
        } else if (typeof parsed === 'object' && parsed !== null) {
          return parsed as admin.ServiceAccount;
        } else {
          break;
        }
      } catch {
        // Not valid JSON, treat as path
        break;
      }
    }

    return current as string;
  }

  /**
   * @param checkRevoked also refuse tokens issued before the user's tokens
   * were revoked (e.g. by a ban); costs one extra call to Firebase.
   */
  async verifyIdToken(
    idToken: string,
    checkRevoked = false,
  ): Promise<admin.auth.DecodedIdToken> {
    if (!this.firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized');
    }
    return admin.auth().verifyIdToken(idToken, checkRevoked);
  }

  /**
   * A custom token for the Firebase user that owns `phone`, creating it on
   * first sign-in, the same account Firebase phone auth would sign in to.
   * `boundUid` is the Firebase account of the backend account that already
   * has this number verified; it wins, so one person isn't split across two
   * Firebase accounts. The client trades the token for an ID token with
   * signInWithCustomToken.
   */
  async customTokenForPhone(phone: string, boundUid?: string): Promise<string> {
    this.assertReady();
    const auth = admin.auth();
    if (boundUid) {
      const bound = await this.findUser(boundUid);
      if (bound) {
        if (bound.phoneNumber !== phone) {
          // So Firebase knows it too; the sign-in works without it.
          await auth
            .updateUser(bound.uid, { phoneNumber: phone })
            .catch((error) =>
              this.logger.warn(
                `Couldn't put the proven number on its bound Firebase account: ${String(error)}`,
              ),
            );
        }
        return auth.createCustomToken(bound.uid);
      }
    }

    let uid: string;
    try {
      uid = (await auth.getUserByPhoneNumber(phone)).uid;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      try {
        uid = (await auth.createUser({ phoneNumber: phone })).uid;
      } catch (createError) {
        // A concurrent sign-in for the same number created it first.
        if (
          (createError as { code?: string }).code !==
          'auth/phone-number-already-exists'
        ) {
          throw createError;
        }
        uid = (await auth.getUserByPhoneNumber(phone)).uid;
      }
    }
    return auth.createCustomToken(uid);
  }

  createCustomToken(uid: string): Promise<string> {
    this.assertReady();
    return admin.auth().createCustomToken(uid);
  }

  /** The Firebase user with this uid, or null. */
  findUser(uid: string): Promise<admin.auth.UserRecord | null> {
    this.assertReady();
    return orNull(admin.auth().getUser(uid));
  }

  /** The Firebase user holding this email, verified or not, or null. */
  findUserByEmail(email: string): Promise<admin.auth.UserRecord | null> {
    this.assertReady();
    return orNull(admin.auth().getUserByEmail(email));
  }

  /**
   * A new Firebase user with `email` verified. If a concurrent request
   * created one first, that one, once it is verified.
   */
  async createProvenEmailUser(email: string): Promise<admin.auth.UserRecord> {
    this.assertReady();
    const auth = admin.auth();
    try {
      return await auth.createUser({ email, emailVerified: true });
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/email-already-exists') {
        throw error;
      }
      const other = await auth.getUserByEmail(email);
      if (!other.emailVerified) throw error;
      return other;
    }
  }

  /**
   * First step of handing over an account that held a proven email
   * unverified (see EmailAuthService): shut out whoever created it. Its
   * password, if any, becomes a random one (the owner can reset it), every
   * other sign-in method is removed, and its sessions are revoked. Reads the
   * account afresh, so a method linked since the caller looked is removed
   * too. Safe to repeat.
   */
  async lockOutForAdoption(uid: string): Promise<void> {
    this.assertReady();
    const auth = admin.auth();
    const user = await auth.getUser(uid);
    const providers = user.providerData.map((p) => p.providerId);
    const others = providers.filter((p) => p !== 'password' && p !== 'phone');
    await auth.updateUser(uid, {
      ...(providers.includes('password') && {
        password: randomBytes(32).toString('base64url'),
      }),
      ...(user.phoneNumber && { phoneNumber: null }),
      ...(others.length && { providersToUnlink: others }),
    });
    await auth.revokeRefreshTokens(uid);
  }

  /**
   * Last step of a handover: the email counts as verified. Last because it
   * is what tells a retry the handover is done; anything that failed before
   * it is simply redone.
   */
  async markEmailVerified(uid: string): Promise<void> {
    this.assertReady();
    await admin.auth().updateUser(uid, { emailVerified: true });
    this.logger.warn(
      'Handed over a Firebase account that held a proven email unverified',
    );
  }

  /** Delete a Firebase user; one already gone (a concurrent delete) is fine. */
  async deleteUser(uid: string): Promise<void> {
    this.assertReady();
    try {
      await admin.auth().deleteUser(uid);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /** Put a proven email, verified, on the user's own Firebase account. */
  async setProvenEmail(uid: string, email: string): Promise<void> {
    this.assertReady();
    try {
      await admin.auth().updateUser(uid, { email, emailVerified: true });
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/email-already-exists') {
        throw new EmailHeldByOtherFirebaseUser();
      }
      throw error;
    }
  }

  private assertReady() {
    if (!this.firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized');
    }
  }

  /**
   * The phone number and email on a Firebase user's record, for sign-ins
   * whose token may not carry them (custom tokens).
   */
  async identifiersOf(uid: string): Promise<{
    phone_number?: string;
    email?: string;
    email_verified: boolean;
  }> {
    if (!this.firebaseApp) return { email_verified: false };
    const user = await admin.auth().getUser(uid);
    return {
      phone_number: user.phoneNumber,
      email: user.email,
      email_verified: user.emailVerified,
    };
  }

  /**
   * Signs a Firebase user out everywhere. Returns false when Firebase isn't
   * configured or the call fails; the caller decides whether that matters.
   */
  async revokeRefreshTokens(uid: string): Promise<boolean> {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase NOT initialized. Skipping token revocation');
      return false;
    }
    try {
      await admin.auth().revokeRefreshTokens(uid);
      return true;
    } catch (error) {
      this.logger.error('Failed to revoke Firebase refresh tokens', error);
      return false;
    }
  }

  /**
   * Send one notification to each of `tokens` (a user's devices).
   *
   * @returns how many devices FCM accepted it for, and the tokens it
   * reported as no longer valid: the app was uninstalled or the token
   * rotated. The caller should forget them; they will never work again. Any
   * other failure is logged and not returned, since the token may work next
   * time.
   */
  async sendToTokens(
    tokens: string[],
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<{ sentCount: number; invalidTokens: string[] }> {
    if (!tokens.length) return { sentCount: 0, invalidTokens: [] };
    if (!this.firebaseApp) {
      this.logger.warn('Firebase NOT initialized. Skipping notification');
      return { sentCount: 0, invalidTokens: [] };
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });

    const invalidTokens: string[] = [];
    const othersSent = response.successCount > 0;
    response.responses.forEach(({ success, error }, index) => {
      if (success) return;
      const code = error?.code ?? '';
      if (
        DEAD_TOKEN_CODES.has(code) ||
        (othersSent && DEAD_IF_OTHERS_SENT.has(code))
      ) {
        invalidTokens.push(tokens[index]);
      } else {
        this.logger.warn(
          `FCM send failed: ${error?.code ?? 'unknown'} ${error?.message ?? ''}`,
        );
      }
    });
    this.logger.log(
      `FCM sent ${response.successCount}/${tokens.length}` +
        (invalidTokens.length ? `, ${invalidTokens.length} dead token(s)` : ''),
    );
    return { sentCount: response.successCount, invalidTokens };
  }
}
