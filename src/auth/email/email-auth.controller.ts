import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { EmailAuthService } from './email-auth.service';
import { SendEmailCodeDto, VerifyEmailCodeDto } from './email-auth.dto';

const TEN_MINUTES = 10 * 60 * 1000;

@ApiTags('Auth')
@Controller('auth/email')
@UseGuards(ThrottlerGuard)
export class EmailAuthController {
  constructor(private readonly emailAuth: EmailAuthService) {}

  @Get('config')
  @ApiOperation({
    summary: 'How email sign-in should send its email',
    description:
      '`provider: firebase`: send a Firebase email link; if Firebase refuses ' +
      'and `fallback` is `server`, use POST /auth/email/send-code instead.\n\n' +
      '`provider: server`: always use POST /auth/email/send-code.',
  })
  config() {
    return {
      state: true,
      statusCode: 200,
      message: 'Email config',
      data: this.emailAuth.getConfig(),
    };
  }

  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES } })
  @ApiOperation({ summary: 'Email a 6-digit sign-in code' })
  async sendCode(@Body() dto: SendEmailCodeDto, @Ip() ip: string) {
    await this.emailAuth.sendSignInCode(dto.email, ip);
    return { state: true, statusCode: 200, message: 'Code sent', data: null };
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: TEN_MINUTES } })
  @ApiOperation({
    summary: 'Check an emailed code and get a Firebase custom token',
    description:
      'Sign in to Firebase with `firebase_token` (signInWithCustomToken), ' +
      'then call POST /auth/firebase-login with the resulting ID token.',
  })
  async verifyCode(@Body() dto: VerifyEmailCodeDto) {
    return {
      state: true,
      statusCode: 200,
      message: 'Code verified',
      data: await this.emailAuth.verifySignInCode(dto.email, dto.code),
    };
  }

  @Post('link/send-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: TEN_MINUTES } })
  @ApiOperation({
    summary: "Email a code to add this email to the signed-in user's account",
  })
  async sendAddEmailCode(
    @GetUser('userId') userId: string,
    @Body() dto: SendEmailCodeDto,
    @Ip() ip: string,
  ) {
    await this.emailAuth.sendAddEmailCode(userId, dto.email, ip);
    return { state: true, statusCode: 200, message: 'Code sent', data: null };
  }

  @Post('link/verify-code')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: TEN_MINUTES } })
  @ApiOperation({
    summary: 'Check the code and save the email as verified',
    description:
      'Same result and errors as POST /user/email: 409 if another account ' +
      'already has this email verified, or this account already has a ' +
      'different verified email.',
  })
  async verifyAddEmailCode(
    @GetUser('userId') userId: string,
    @GetUser('sessionToken') sessionToken: string,
    @Body() dto: VerifyEmailCodeDto,
  ) {
    return this.emailAuth.verifyAddEmailCode(
      userId,
      dto.email,
      dto.code,
      sessionToken,
    );
  }
}
