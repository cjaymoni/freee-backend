import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SmsAuthService } from './sms-auth.service';
import { SendSmsCodeDto, VerifySmsCodeDto } from './sms-auth.dto';

const TEN_MINUTES = 10 * 60 * 1000;

@ApiTags('Auth')
@Controller('auth/sms')
@UseGuards(ThrottlerGuard)
export class SmsAuthController {
  constructor(private readonly smsAuth: SmsAuthService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Which SMS sender phone sign-in should use',
    description:
      '`provider: firebase`: send the code with the Firebase SDK; if Firebase ' +
      'refuses to send and `fallback` is `twilio`, use POST /auth/sms/send-code ' +
      'instead.\n\n`provider: twilio`: always use POST /auth/sms/send-code.',
  })
  config() {
    return {
      state: true,
      statusCode: 200,
      message: 'SMS config',
      data: this.smsAuth.getConfig(),
    };
  }

  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  // Twilio also limits sends per number; this caps one client spraying
  // many numbers (SMS pumping).
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES } })
  @ApiOperation({ summary: 'Text a sign-in code from the server (Twilio)' })
  async sendCode(@Body() dto: SendSmsCodeDto) {
    await this.smsAuth.sendCode(dto.phone_number);
    return { state: true, statusCode: 200, message: 'Code sent', data: null };
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: TEN_MINUTES } })
  @ApiOperation({
    summary: 'Check a server-sent code and get a Firebase custom token',
    description:
      'Sign in to Firebase with `firebase_token` (signInWithCustomToken), ' +
      'then call POST /auth/firebase-login with the resulting ID token.',
  })
  async verifyCode(@Body() dto: VerifySmsCodeDto) {
    return {
      state: true,
      statusCode: 200,
      message: 'Code verified',
      data: await this.smsAuth.verifyCode(dto.phone_number, dto.code),
    };
  }
}
