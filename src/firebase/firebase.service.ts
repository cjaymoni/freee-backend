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

    try {
      if (serviceAccountJson) {
        const serviceAccount = JSON.parse(
          serviceAccountJson,
        ) as admin.ServiceAccount;
        if (serviceAccount.privateKey) {
          serviceAccount.privateKey = serviceAccount.privateKey.replace(
            /\\n/g,
            '\n',
          );
        }
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.logger.log('Firebase Admin initialized via JSON');
      } else if (serviceAccountPath) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccountPath),
        });
        this.logger.log(
          `Firebase Admin initialized via path: ${serviceAccountPath}`,
        );
      } else {
        this.logger.warn(
          'Firebase credentials not found. Firebase features will be unavailable.',
        );
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
    }
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
      this.logger.log(`Successfully sent message: ${response}`);
      return response;
    } catch (error) {
      this.logger.error('Error sending FCM message', error);
      throw error;
    }
  }
}
