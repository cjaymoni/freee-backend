import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendVerificationCode(email: string, code: string) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Your Verification Code',
        template: './verification-code', // We might not use templates yet, simpler text for now
        context: {
          code,
        },
        text: `Your verification code is: ${code}. It expires in 10 minutes.`,
        html: `<b>Your verification code is: ${code}</b><p>It expires in 10 minutes.</p>`,
      });
      this.logger.log(`Verification code sent to ${email}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.stack : 'Unknown error';
      this.logger.error(`Failed to send email to ${email}`, errorMessage);
      throw error;
    }
  }

  async sendPasswordResetCode(email: string, code: string) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Password Reset Code',
        text: `Your password reset code is: ${code}. It expires in 10 minutes.`,
        html: `<b>Your password reset code is: ${code}</b><p>It expires in 10 minutes.</p>`,
      });
      this.logger.log(`Password reset code sent to ${email}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.stack : 'Unknown error';
      this.logger.error(
        `Failed to send password reset email to ${email}`,
        errorMessage,
      );
      throw error;
    }
  }
  async sendFirebaseLink(email: string, link: string, type: string) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: `${type} Link`,
        text: `Please click the following link to complete your ${type}: ${link}`,
        html: `<h3>${type}</h3><p>Please click the button below to complete your ${type}:</p><a href="${link}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Complete ${type}</a><p>If the button doesn't work, copy and paste this link: <br/> ${link}</p>`,
      });
      this.logger.log(`${type} link sent to ${email}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to send ${type} email to ${email}`);
      throw error;
    }
  }
}
