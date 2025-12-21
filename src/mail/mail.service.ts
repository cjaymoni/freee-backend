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
}
