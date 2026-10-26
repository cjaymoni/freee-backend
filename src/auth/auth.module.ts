import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { FirebaseAuthController } from './firebase-auth.controller';
import { FirebaseAuthService } from './firebase-auth.service';
import { AccountLockoutService } from './account-lockout.service';
import { VerificationCodeEntity } from './entities/verification-code.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { LoginAttemptEntity } from './entities/login-attempt.entity';
import { UserEntity } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { MailModule } from '../mail/mail.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SmsAuthController } from './sms/sms-auth.controller';
import { SmsAuthService } from './sms/sms-auth.service';
import { TwilioVerifyClient } from './sms/twilio-verify.client';
import { EmailAuthController } from './email/email-auth.controller';
import { EmailAuthService } from './email/email-auth.service';
import { ChatRealtimeModule } from '../chat/chat-realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VerificationCodeEntity,
      UserSessionEntity,
      LoginAttemptEntity,
      UserEntity,
    ]),
    UserModule,
    MailModule,
    // To drop the sockets of an account adopted on email sign-in.
    ChatRealtimeModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'defaultSecret',
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [
    AuthController,
    FirebaseAuthController,
    SmsAuthController,
    EmailAuthController,
  ],
  providers: [
    AuthService,
    FirebaseAuthService,
    AccountLockoutService,
    JwtStrategy,
    SmsAuthService,
    TwilioVerifyClient,
    EmailAuthService,
  ],
  exports: [AuthService, AccountLockoutService],
})
export class AuthModule {}
