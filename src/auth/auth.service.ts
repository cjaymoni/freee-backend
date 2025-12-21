import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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
import { UserEntity } from '../user/entities/user.entity';

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
    private readonly dataSource: DataSource,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, ...otherDetails } = registerDto;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
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

        // Note: userService.create now also uses its own queryRunner if called normally.
        // It might be better to allow passing a manager to service methods for nested transactions.
        // For now, let's just use the queryRunner manager here directly or keep it as is.
        // Since userService.create uses queryRunner internally, we might have nested transaction issues if not careful.
        // I will keep it simple for now and just wrap the code in register if possible.
        // Actually, calling another service method that starts its own transaction inside this transaction
        // will not work as expected with QueryRunner unless we pass the manager.

        // I'll refactor UserService.create later to accept an optional manager.
        // For now, I'll just keep register as is or refactor it to use manager directly.

        await this.userService.create(
          createUserDto,
          undefined,
          {
            is_active: false,
            is_verified: false,
          },
          queryRunner.manager,
        );
        user = (await queryRunner.manager.findOne(UserEntity, {
          where: { email },
        })) as UserEntity;
      } else {
        await this.userService.update(
          user.id,
          {
            password_hash: password,
            ...otherDetails,
          },
          queryRunner.manager,
        );
        user = (await queryRunner.manager.findOne(UserEntity, {
          where: { id: user.id },
        })) as UserEntity;
      }

      if (!user) throw new Error('Failed to create or retrieve user');

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const verificationCode = queryRunner.manager.create(
        VerificationCodeEntity,
        {
          user,
          email,
          code_hash: code,
          code_type: 'email_verification',
          expires_at: expiresAt,
        },
      );

      await this.mailService.sendVerificationCode(email, code);

      const saltCode = await bcrypt.genSalt();
      verificationCode.code_hash = await bcrypt.hash(code, saltCode);

      await queryRunner.manager.save(verificationCode);
      await queryRunner.commitTransaction();

      return { message: 'Verification code sent to email' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const { email, code } = verifyEmailDto;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const verificationCode = await queryRunner.manager.findOne(
        VerificationCodeEntity,
        {
          where: { email, is_verified: false, code_type: 'email_verification' },
          order: { created_at: 'DESC' },
          relations: ['user'],
        },
      );

      if (!verificationCode) {
        throw new BadRequestException('Invalid or expired verification code');
      }

      if (verificationCode.expires_at < new Date()) {
        throw new BadRequestException('Verification code expired');
      }

      const isMatch = await bcrypt.compare(code, verificationCode.code_hash);
      if (!isMatch) {
        verificationCode.attempt_count += 1;
        await queryRunner.manager.save(verificationCode);
        await queryRunner.commitTransaction();
        throw new BadRequestException('Invalid verification code');
      }

      verificationCode.is_verified = true;
      verificationCode.verified_at = new Date();
      await queryRunner.manager.save(verificationCode);

      const user = verificationCode.user;
      await this.userService.update(
        user.id,
        {
          is_verified: true,
          is_active: true,
        },
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
      return { message: 'Email verified successfully' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Record login attempt
      const loginAttempt = queryRunner.manager.create(LoginAttemptEntity, {
        user: user || undefined,
        email: email,
        ip_address: ip,
        user_agent: userAgent,
        attempt_result: attemptResult,
        failure_reason: failureReason || undefined,
      });
      await queryRunner.manager.save(loginAttempt);

      if (attemptResult === 'failed') {
        await queryRunner.commitTransaction();
        throw new UnauthorizedException(
          failureReason === 'account_not_active'
            ? 'Account is not active'
            : 'Invalid credentials',
        );
      }

      if (!user) {
        await queryRunner.commitTransaction();
        throw new UnauthorizedException('Invalid credentials');
      }

      // Invalidate previous active sessions
      await queryRunner.manager.update(
        UserSessionEntity,
        { user: { id: user.id }, is_active: true },
        { is_active: false },
      );

      // Create session
      const sessionToken = randomBytes(32).toString('hex');
      const refreshToken = randomBytes(64).toString('hex');

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

      const session = queryRunner.manager.create(UserSessionEntity, {
        user,
        session_token: sessionToken,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshExpiresAt,
        ip_address: ip,
        user_agent: userAgent,
        expires_at: expiresAt,
        device_type: 'web',
      });

      await queryRunner.manager.save(session);
      await queryRunner.commitTransaction();

      // Generate JWT
      const payload = {
        sub: user.id,
        email: user.email,
        session_token: sessionToken,
      };
      const accessToken = this.jwtService.sign(payload);

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
        },
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async refresh(refreshToken: string, ip: string, userAgent: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const session = await queryRunner.manager.findOne(UserSessionEntity, {
        where: { refresh_token: refreshToken, is_active: true },
        relations: ['user'],
      });

      if (!session || session.refresh_token_expires_at < new Date()) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Token Rotation: Invalidate old session and create a new one
      session.is_active = false;
      await queryRunner.manager.save(session);

      const user = session.user;
      const newSessionToken = randomBytes(32).toString('hex');
      const newRefreshToken = randomBytes(64).toString('hex');

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

      const newSession = queryRunner.manager.create(UserSessionEntity, {
        user,
        session_token: newSessionToken,
        refresh_token: newRefreshToken,
        refresh_token_expires_at: refreshExpiresAt,
        ip_address: ip,
        user_agent: userAgent,
        expires_at: expiresAt,
        device_type: session.device_type,
      });

      await queryRunner.manager.save(newSession);
      await queryRunner.commitTransaction();

      const payload = {
        sub: user.id,
        email: user.email,
        session_token: newSessionToken,
      };
      const accessToken = this.jwtService.sign(payload);

      return {
        access_token: accessToken,
        refresh_token: newRefreshToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async validateSession(sessionToken: string): Promise<boolean> {
    const session = await this.userSessionRepository.findOne({
      where: { session_token: sessionToken },
    });

    return !!(session && session.is_active && session.expires_at > new Date());
  }
}
