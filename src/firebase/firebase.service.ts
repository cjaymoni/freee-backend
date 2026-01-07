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
      let credential: any;

      if (serviceAccountJson) {
        credential = JSON.parse(serviceAccountJson);
        this.logger.log('Firebase: Using credentials from JSON variable');
      } else if (serviceAccountPath) {
        const trimmedPath = serviceAccountPath.trim();
        if (trimmedPath.startsWith('{')) {
          credential = JSON.parse(trimmedPath);
          this.logger.log(
            'Firebase: Using credentials from JSON in path variable',
          );
        } else {
          credential = serviceAccountPath;
          this.logger.log(
            `Firebase: Using credentials from path: ${serviceAccountPath}`,
          );
        }
      }

      if (credential) {
        // Fix private key formatting if we have an object
        if (typeof credential === 'object' && credential.private_key) {
          credential.private_key = credential.private_key.replace(/\\n/g, '\n');
        }

        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(credential),
        });
        this.logger.log('Firebase Admin initialized successfully');
      } else {
        this.logger.warn(
          'Firebase credentials not found. Firebase features will be unavailable.',
        );
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
      // Log the first few characters of the source to help debugging
      const source = serviceAccountJson || serviceAccountPath || 'none';
      this.logger.error(`Source begins with: ${source.substring(0, 20)}...`);
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
