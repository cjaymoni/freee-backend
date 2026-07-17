import {
  Controller,
  Post,
  Body,
  Ip,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseAuthDto } from './dto/firebase-auth.dto';
import { FirebaseEmailDto } from './dto/firebase-email.dto';
import { UserAgent } from '../common/decorators/user-agent.decorator';

@ApiTags('Firebase Auth')
@Controller('firebase-auth')
export class FirebaseAuthController {
  private readonly logger = new Logger(FirebaseAuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly firebaseAuthService: FirebaseAuthService,
  ) {}

  @Post('authenticate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange Firebase ID Token for local JWT',
    description:
      '**Screens 1-3** — Entry point for the onboarding flow.\n\n' +
      'Mobile completes phone/social OTP via Firebase SDK, then sends the `idToken` here to receive a local JWT + refresh token.\n\n' +
      'Response includes `is_onboarded: false` for new users, signalling the app to start the onboarding screens.',
  })
  @ApiOkResponse({
    description: 'Authentication successful',
    schema: {
      example: {
        state: true,
        statusCode: 200,
        message: 'Authentication successful',
        data: {
          access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refresh_token: 'a1b2c3d4e5f6...',
          user: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            email: 'user@example.com',
            role: 'USER',
            is_onboarded: false,
            avatar: 'https://api.dicebear.com/9.x/adventurer/svg?seed=123e4567',
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired Firebase ID token' })
  async authenticate(
    @Body() firebaseAuthDto: FirebaseAuthDto,
    @Ip() ip: string,
    @UserAgent() userAgent: string,
  ) {
    this.logger.log(`[authenticate] incoming request`);
    return this.authService.firebaseAuthenticate(
      firebaseAuthDto,
      ip,
      userAgent,
    );
  }

  @Post('send-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send Firebase email verification link' })
  async sendVerificationEmail(@Body() firebaseEmailDto: FirebaseEmailDto) {
    return this.firebaseAuthService.sendVerificationEmail(
      firebaseEmailDto.email,
    );
  }

  @Post('send-password-reset-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send Firebase password reset link' })
  async sendPasswordResetEmail(@Body() firebaseEmailDto: FirebaseEmailDto) {
    return this.firebaseAuthService.sendPasswordResetEmail(
      firebaseEmailDto.email,
    );
  }

  @Post('send-signin-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send Firebase passwordless sign-in link' })
  async sendSignInLink(@Body() firebaseEmailDto: FirebaseEmailDto) {
    return this.firebaseAuthService.sendSignInLink(firebaseEmailDto.email);
  }

  @Post('revoke-sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all active Firebase sessions for a user' })
  async revokeSessions(@Body() firebaseEmailDto: FirebaseEmailDto) {
    return this.firebaseAuthService.revokeRefreshTokens(firebaseEmailDto.email);
  }
}
