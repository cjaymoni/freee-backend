import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

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

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    if (!this.firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized');
    }
    return admin.auth().verifyIdToken(idToken);
  }

  async sendNotification(
    token: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ) {
    if (!this.firebaseApp) {
      this.logger.warn('Firebase NOT initialized. Skipping notification');
      return;
    }

    const message: admin.messaging.Message = {
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      token: token,
    };

    try {
      const response = await admin.messaging().send(message);
      this.logger.log('Successfully sent FCM message', {
        messageId: String(response).replace(/[^\w-]/g, ''),
      });
      return response;
    } catch (error) {
      this.logger.error('Error sending FCM message', error);
      throw error;
    }
  }
}
