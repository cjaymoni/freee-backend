import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { VerificationCodeEntity } from './entities/verification-code.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { LoginAttemptEntity } from './entities/login-attempt.entity';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../user/dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    @InjectRepository(VerificationCodeEntity)
    private readonly verificationCodeRepository: Repository<VerificationCodeEntity>,
    @InjectRepository(UserSessionEntity)
    private readonly userSessionRepository: Repository<UserSessionEntity>,
    @InjectRepository(LoginAttemptEntity)
    private readonly loginAttemptRepository: Repository<LoginAttemptEntity>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, ...otherDetails } = registerDto;

    const existingUser = await this.userService.findByEmail(email);
    if (existingUser && existingUser.is_active) {
      throw new ConflictException('User with this email already exists');
    }

    let user = existingUser;

    if (!user) {
      const createUserDto: CreateUserDto = {
        email,
        password_hash: password,
        ...otherDetails,
      };

      await this.userService.create(createUserDto, undefined, {
        is_active: false,
        is_verified: false,
      });
      // Refresh user
      user = await this.userService.findByEmail(email);
    } else {
      // Update existing inactive user
      await this.userService.update(user.id, {
        password_hash: password,
        ...otherDetails,
      });
      // Refresh user
      user = await this.userService.findByEmail(email);
    }

    if (!user) throw new Error('Failed to create or retrieve user');

    // Generate and send OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 mins expiry

    const verificationCode = this.verificationCodeRepository.create({
      user,
      email,
      code_hash: code,
      code_type: 'email_verification',
      expires_at: expiresAt,
    });

    // Send email via Brevo
    await this.mailService.sendVerificationCode(email, code);

    // Store hashed code
    const saltCode = await bcrypt.genSalt();
    verificationCode.code_hash = await bcrypt.hash(code, saltCode);

    await this.verificationCodeRepository.save(verificationCode);

    return { message: 'Verification code sent to email' };
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { email, code } = verifyEmailDto;

    // Find latest valid code
    const verificationCode = await this.verificationCodeRepository.findOne({
      where: { email, is_verified: false, code_type: 'email_verification' },
      order: { created_at: 'DESC' },
      relations: ['user'],
    });

    if (!verificationCode) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (verificationCode.expires_at < new Date()) {
      throw new BadRequestException('Verification code expired');
    }

    const isMatch = await bcrypt.compare(code, verificationCode.code_hash);
    if (!isMatch) {
      verificationCode.attempt_count += 1;
      await this.verificationCodeRepository.save(verificationCode);
      throw new BadRequestException('Invalid verification code');
    }

    // Mark code as verified
    verificationCode.is_verified = true;
    verificationCode.verified_at = new Date();
    await this.verificationCodeRepository.save(verificationCode);

    // Activate user
    const user = verificationCode.user;
    await this.userService.update(user.id, {
      is_verified: true,
      is_active: true,
    });

    return { message: 'Email verified successfully' };
  }

  async login(loginDto: LoginDto, ip: string, userAgent: string) {
    const { email, password } = loginDto;
    const user = await this.userService.findByEmail(email);

    let attemptResult = 'success';
    let failureReason: string | null = null;

    if (!user) {
      attemptResult = 'failed';
      failureReason = 'account_not_found';
    } else if (!user.is_active) {
      attemptResult = 'failed';
      failureReason = 'account_not_active';
    } else {
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        attemptResult = 'failed';
        failureReason = 'invalid_password';
      }
    }

    // Record login attempt
    const loginAttempt = this.loginAttemptRepository.create({
      user: user || undefined,
      email: email,
      ip_address: ip,
      user_agent: userAgent,
      attempt_result: attemptResult,
      failure_reason: failureReason || undefined,
    });
    await this.loginAttemptRepository.save(loginAttempt);

    if (attemptResult === 'failed') {
      throw new UnauthorizedException(
        failureReason === 'account_not_active'
          ? 'Account is not active'
          : 'Invalid credentials',
      );
    }

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Invalidate previous active sessions
    await this.userSessionRepository.update(
      { user: { id: user.id }, is_active: true },
      { is_active: false },
    );

    // Create session
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days session

    const session = this.userSessionRepository.create({
      user,
      session_token: sessionToken,
      ip_address: ip,
      user_agent: userAgent,
      expires_at: expiresAt,
      device_type: 'web', // Default
    });

    await this.userSessionRepository.save(session);

    // Generate JWT
    const payload = {
      sub: user.id,
      email: user.email,
      session_token: sessionToken,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
      },
    };
  }

  async validateSession(sessionToken: string): Promise<boolean> {
    const session = await this.userSessionRepository.findOne({
      where: { session_token: sessionToken },
    });

    return !!(session && session.is_active && session.expires_at > new Date());
  }
}
