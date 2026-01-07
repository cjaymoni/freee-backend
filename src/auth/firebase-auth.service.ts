import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { MailService } from '../mail/mail.service';
import { UserService } from '../user/user.service';

@Injectable()
export class FirebaseAuthService {
  private readonly logger = new Logger(FirebaseAuthService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly userService: UserService,
  ) {}

  async sendVerificationEmail(email: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User with this email not found');
    }

    try {
      const link = await admin.auth().generateEmailVerificationLink(email);

      // Send via our own MailService to maintain branding
      await this.mailService.sendFirebaseLink(
        email,
        link,
        'Email Verification',
      );

      this.logger.log(`Verification link sent to ${email}`);
      return { message: 'Verification email sent successfully' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to generate verification link: ${errorMessage}`,
      );
      throw new BadRequestException('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(email: string) {
    try {
      const link = await admin.auth().generatePasswordResetLink(email);

      await this.mailService.sendFirebaseLink(email, link, 'Password Reset');

      this.logger.log(`Password reset link sent to ${email}`);
      return { message: 'Password reset email sent successfully' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to generate password reset link: ${errorMessage}`,
      );
      // Don't leak if user exists or not for reset, but Firebase requires a valid user
      throw new BadRequestException(
        'If an account exists, a reset link has been sent',
      );
    }
  }

  async sendSignInLink(email: string) {
    try {
      const actionCodeSettings = {
        url:
          process.env.FIREBASE_CONTINUE_URL ||
          'http://localhost:3000/auth/callback',
        handleCodeInApp: true,
      };
      const link = await admin
        .auth()
        .generateSignInWithEmailLink(email, actionCodeSettings);

      await this.mailService.sendFirebaseLink(email, link, 'Sign In');
      this.logger.log(`Sign-in link sent to ${email}`);
      return { message: 'Sign-in link sent successfully' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate sign-in link: ${errorMessage}`);
      throw new BadRequestException('Failed to send sign-in link');
    }
  }

  async revokeRefreshTokens(email: string) {
    const user = await this.userService.findByEmail(email);
    if (!user || !user.firebase_uid) {
      throw new NotFoundException('Firebase user not found');
    }

    try {
      await admin.auth().revokeRefreshTokens(user.firebase_uid);
      this.logger.log(`Tokens revoked for user: ${email}`);
      return { message: 'All active sessions have been signed out' };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to revoke tokens: ${errorMessage}`);
      throw new BadRequestException('Failed to revoke sessions');
    }
  }
}
