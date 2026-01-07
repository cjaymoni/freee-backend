import {
  Controller,
  Post,
  Body,
  Ip,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseAuthDto } from './dto/firebase-auth.dto';
import { FirebaseEmailDto } from './dto/firebase-email.dto';
import { UserAgent } from '../common/decorators/user-agent.decorator';

@ApiTags('Firebase Auth')
@Controller('firebase-auth')
export class FirebaseAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly firebaseAuthService: FirebaseAuthService,
  ) {}

  @Post('authenticate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Firebase ID Token for local JWT' })
  async authenticate(
    @Body() firebaseAuthDto: FirebaseAuthDto,
    @Ip() ip: string,
    @UserAgent() userAgent: string,
  ) {
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
