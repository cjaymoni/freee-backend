import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  private getTemplate(
    title: string,
    body: string,
    footerNote?: string,
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 40px 0; }
    .wrapper { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { padding: 30px; border-bottom: 1px solid #f1f5f9; text-align: left; }
    .logo { color: #0099ee; font-size: 36px; font-weight: 700; font-family: 'Brush Script MT', cursive, sans-serif; letter-spacing: -1px; }
    .content { padding: 40px 30px; color: #334155; }
    .h1 { font-size: 24px; font-weight: 700; color: #1e293b; margin-top: 0; margin-bottom: 24px; }
    .text { font-size: 16px; line-height: 24px; color: #475569; margin-bottom: 24px; }
    .action-box { text-align: left; margin: 30px 0; }
    .code { font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: 4px; }
    .button { display: inline-block; padding: 14px 28px; background-color: #0ea5e9; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; }
    .footer { padding: 30px; background-color: #ffffff; border-top: 1px solid #f1f5f9; }
    .security-note { font-size: 14px; color: #64748b; line-height: 22px; }
    .hr { border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0; }
    .bottom-info { text-align: center; margin-top: 30px; font-size: 13px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">freeee</div>
    </div>
    <div class="content">
      <div class="h1">${title}</div>
      ${body}
    </div>
    <div class="footer">
      <div class="security-note">
        ${footerNote || "For your security, this code will expire in 10 minutes. If you didn't request this email, you can safely ignore it — no action is required."}
      </div>
    </div>
  </div>
  <div class="bottom-info">
    © 2026 Freeee, 55 Kofi Annan East Avenue, North Legon, Accra, Ghana
  </div>
</body>
</html>`;
  }

  async sendVerificationCode(email: string, code: string) {
    try {
      const html = this.getTemplate(
        'Verify your email address',
        `<p class="text">In order to complete your account registration, you need to verify your email address by entering the following code:</p>
         <div class="action-box"><span class="code">${code}</span></div>`,
      );

      await this.mailerService.sendMail({
        to: email,
        subject: 'Verify your email address',
        text: `Your verification code is: ${code}. It expires in 10 minutes.`,
        html,
      });
      this.logger.log(`Verification code sent`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send email: ${errorMessage}`);
      throw error;
    }
  }

  async sendPasswordResetCode(email: string, code: string) {
    try {
      const html = this.getTemplate(
        'Reset your password',
        `<p class="text">We received a request to reset your password. Please use the following code to proceed:</p>
         <div class="action-box"><span class="code">${code}</span></div>`,
      );

      await this.mailerService.sendMail({
        to: email,
        subject: 'Password Reset Code',
        text: `Your password reset code is: ${code}. It expires in 10 minutes.`,
        html,
      });
      this.logger.log(`Password reset code sent`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send password reset email: ${errorMessage}`);
      throw error;
    }
  }

  async sendFirebaseLink(email: string, link: string, type: string) {
    try {
      const html = this.getTemplate(
        `${type} your account`,
        `<p class="text">In order to complete your ${type.toLowerCase()}, please click the button below:</p>
         <div class="action-box">
           <a href="${link}" class="button">Complete ${type}</a>
         </div>
         <p class="text" style="font-size: 13px;">If the button doesn't work, copy and paste this link:<br/>${link}</p>`,
        `For your security, this ${type.toLowerCase()} link has a limited duration. If you didn't request this, you can safely ignore this email.`,
      );

      await this.mailerService.sendMail({
        to: email,
        subject: `${type} Link`,
        text: `Please click the following link to complete your ${type}: ${link}`,
        html,
      });
      this.logger.log(`${type} link sent`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send ${type} email: ${errorMessage}`);
      throw error;
    }
  }
}
