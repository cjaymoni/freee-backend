import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  FindOptionsWhere,
  QueryFailedError,
} from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { AccountLockoutService } from './account-lockout.service';
import { VerificationCodeEntity } from './entities/verification-code.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { LoginAttemptEntity } from './entities/login-attempt.entity';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserEntity } from '../user/entities/user.entity';
import { FirebaseService } from '../firebase/firebase.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { FirebaseAuthDto } from './dto/firebase-auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private isConflictError(error: unknown): boolean {
    if (error instanceof ConflictException) {
      return true;
    }

    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string } | undefined;
      return driverError?.code === '23505';
    }

    return false;
  }

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
    private readonly firebaseService: FirebaseService,
    private readonly accountLockoutService: AccountLockoutService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, phone_number, ...otherDetails } = registerDto;

    // 1. Initial existence check (fail fast)
    const existingUser = await this.userService.findByEmailOrPhone(
      email,
      phone_number,
    );
    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 2. Persist User Record (strictly DB creation)
      const createUserDto: CreateUserDto = {
        email,
        password: password,
        phone_number,
        ...otherDetails,
      };

      const userServiceResponse = await this.userService.create(
        createUserDto,
        undefined,
        {
          is_active: false,
          is_email_verified: false,
          source: 'auth.register',
        },
        queryRunner.manager,
      );

      // Extract the created user entity from the response data
      // (Note: UserResponseDto is returned by create, but we need the Entity id for relations)
      const userId = userServiceResponse.data.id;

      const user = await queryRunner.manager.findOne(UserEntity, {
        where: { id: userId },
      });

      if (!user) {
        throw new Error('Failed to retrieve created user');
      }

      // 3. Initiate Verification Flow (Business Logic)
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

      // Send the email first (if this fails, transaction rolls back)
      await this.mailService.sendVerificationCode(email, code);

      // Hash the code before saving to DB
      const saltCode = await bcrypt.genSalt();
      verificationCode.code_hash = await bcrypt.hash(code, saltCode);

      await queryRunner.manager.save(verificationCode);
      await queryRunner.commitTransaction();

      return {
        message: 'Registration successful. Verification code sent to email.',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async resendVerificationCode(email: string) {
    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.is_email_verified) {
      throw new BadRequestException('User is already verified');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Invalidate existing codes
      await queryRunner.manager.update(
        VerificationCodeEntity,
        { email, is_verified: false, code_type: 'email_verification' },
        { expires_at: new Date() },
      );

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

      return { message: 'Verification code resent successfully' };
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
          is_email_verified: true,
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

  async firebaseAuthenticate(
    firebaseAuthDto: FirebaseAuthDto,
    ip: string,
    userAgent: string,
  ) {
    const { idToken } = firebaseAuthDto;
    let decodedToken: admin.auth.DecodedIdToken;

    try {
      decodedToken = await this.firebaseService.verifyIdToken(idToken);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Firebase token verification failed: ${errorMessage}`);
      throw new UnauthorizedException(`Authentication failed: ${errorMessage}`);
    }

    const { email, phone_number, uid: firebase_uid } = decodedToken;
    this.logger.log(
      `[firebaseAuthenticate] decoded token => uid: ${firebase_uid}, email: ${email ?? 'none'}, phone: ${phone_number ?? 'none'}`,
    );

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(UserEntity);
      const sessionRepo = manager.getRepository(UserSessionEntity);

      let user = await userRepo.findOne({ where: { firebase_uid } });

      if (!user) {
        const whereConditions: FindOptionsWhere<UserEntity>[] = [];
        if (email) {
          whereConditions.push({ email });
        }
        if (phone_number) {
          whereConditions.push({ phone_number });
        }

        if (whereConditions.length > 0) {
          user = await userRepo.findOne({ where: whereConditions });
        }

        if (user) {
          user.firebase_uid = firebase_uid;
          if (email && !user.email) {
            user.email = email;
          }
          if (phone_number && !user.phone_number) {
            user.phone_number = phone_number;
          }
          await userRepo.save(user);
        }
      } else {
        let needsUpdate = false;
        if (email && !user.email) {
          user.email = email;
          needsUpdate = true;
        }
        if (phone_number && !user.phone_number) {
          user.phone_number = phone_number;
          needsUpdate = true;
        }
        if (needsUpdate) {
          await userRepo.save(user);
        }
      }

      if (!user) {
        const createUserDto: CreateUserDto = {
          email: email || undefined,
          phone_number,
          firebase_uid,
        };

        try {
          const userServiceResponse = await this.userService.create(
            createUserDto,
            undefined,
            {
              is_active: true,
              is_email_verified: decodedToken.email_verified || false,
              is_phone_verified: !!phone_number,
              source: 'auth.firebaseAuthenticate',
              upsertOnConflict: true,
            },
            manager,
          );

          user = (await userRepo.findOne({
            where: { id: userServiceResponse.data.id },
          })) as UserEntity;
        } catch (error) {
          if (!this.isConflictError(error)) {
            throw error;
          }

          const conflictWhere: FindOptionsWhere<UserEntity>[] = [
            { firebase_uid },
          ];
          if (email) {
            conflictWhere.push({ email });
          }
          if (phone_number) {
            conflictWhere.push({ phone_number });
          }

          user = await userRepo.findOne({ where: conflictWhere });
          if (!user) {
            throw error;
          }

          // Existing user won the race; merge token-derived values and continue.
          let needsMergeUpdate = false;
          if (!user.firebase_uid) {
            user.firebase_uid = firebase_uid;
            needsMergeUpdate = true;
          }
          if (email && !user.email) {
            user.email = email;
            needsMergeUpdate = true;
          }
          if (phone_number && !user.phone_number) {
            user.phone_number = phone_number;
            needsMergeUpdate = true;
          }
          if (needsMergeUpdate) {
            await userRepo.save(user);
          }
        }
      }

      let needsStatusUpdate = false;
      if (decodedToken.email_verified && !user.is_email_verified) {
        user.is_email_verified = true;
        needsStatusUpdate = true;
      }
      if (phone_number && !user.is_phone_verified) {
        user.is_phone_verified = true;
        needsStatusUpdate = true;
      }
      if (needsStatusUpdate) {
        await userRepo.save(user);
      }

      const sessionToken = randomBytes(32).toString('hex');
      const refreshToken = randomBytes(64).toString('hex');

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);

      const session = sessionRepo.create({
        user,
        session_token: sessionToken,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshExpiresAt,
        ip_address: ip,
        user_agent: userAgent,
        expires_at: expiresAt,
        device_type: 'mobile',
      });

      await sessionRepo.save(session);

      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        session_token: sessionToken,
      };

      const response = {
        state: true,
        statusCode: 200,
        message: 'Authentication successful',
        data: {
          access_token: this.jwtService.sign(payload),
          refresh_token: refreshToken,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            is_onboarded: user.is_onboarded,
            avatar: user.cloudinary_avatar_url,
          },
        },
      };

      this.logger.log(
        `[firebaseAuthenticate] response => ${JSON.stringify(response.data.user)}`,
      );
      return response;
    });
  }

  async firebaseLogin(
    firebaseLoginDto: FirebaseLoginDto,
    ip: string,
    userAgent: string,
  ) {
    // Wrap the new robust method to maintain backward compatibility
    return this.firebaseAuthenticate(
      { idToken: firebaseLoginDto.idToken },
      ip,
      userAgent,
    );
  }

  async login(loginDto: LoginDto, ip: string, userAgent: string) {
    const { email, password } = loginDto;
    const user = await this.userService.findByEmail(email);

    // Check if account is locked
    if (user) {
      const isLocked = await this.accountLockoutService.isAccountLocked(
        user.id,
      );
      if (isLocked) {
        const remainingTime =
          await this.accountLockoutService.getRemainingLockoutTime(user.id);
        throw new UnauthorizedException(
          `Account is locked. Try again in ${remainingTime} minutes.`,
        );
      }
    }

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
        // Record failed attempt for lockout tracking
        if (user) {
          await this.accountLockoutService.recordFailedAttempt(user.id);
        }
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

      // Reset failed attempts on successful login
      await this.accountLockoutService.resetFailedAttempts(user.id);

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
        role: user.role,
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
          avatar: user.cloudinary_avatar_url,
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
        role: user.role,
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

  async getUserForValidation(userId: string) {
    return await this.userService.findOneEntity(userId);
  }

  async getMe(userId: string) {
    return await this.userService.findOne(userId);
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const { currentPassword, newPassword } = changePasswordDto;
    const user = await this.userService.findOneEntity(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      throw new BadRequestException('Invalid current password');
    }

    await this.userService.update(userId, { password: newPassword });

    return { message: 'Password changed successfully' };
  }

  async logout(userId: string, sessionToken: string) {
    await this.userSessionRepository.update(
      { user: { id: userId }, session_token: sessionToken, is_active: true },
      { is_active: false },
    );
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;
    const user = await this.userService.findByEmail(email);

    if (!user) {
      // For security, don't reveal if user exists
      return { message: 'If an account exists, a reset code has been sent.' };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Invalidate existing reset codes
      await queryRunner.manager.update(
        VerificationCodeEntity,
        { email, is_verified: false, code_type: 'password_reset' },
        { expires_at: new Date() },
      );

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const verificationCode = queryRunner.manager.create(
        VerificationCodeEntity,
        {
          user,
          email,
          code_hash: code,
          code_type: 'password_reset',
          expires_at: expiresAt,
        },
      );

      await this.mailService.sendPasswordResetCode(email, code);

      const saltCode = await bcrypt.genSalt();
      verificationCode.code_hash = await bcrypt.hash(code, saltCode);

      await queryRunner.manager.save(verificationCode);
      await queryRunner.commitTransaction();

      return { message: 'Password reset code sent to email.' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { email, code, password } = resetPasswordDto;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const verificationCode = await queryRunner.manager.findOne(
        VerificationCodeEntity,
        {
          where: { email, is_verified: false, code_type: 'password_reset' },
          order: { created_at: 'DESC' },
          relations: ['user'],
        },
      );

      if (!verificationCode) {
        throw new BadRequestException('Invalid or expired reset code');
      }

      if (verificationCode.expires_at < new Date()) {
        throw new BadRequestException('Reset code expired');
      }

      const isMatch = await bcrypt.compare(code, verificationCode.code_hash);
      if (!isMatch) {
        verificationCode.attempt_count += 1;
        await queryRunner.manager.save(verificationCode);
        await queryRunner.commitTransaction();
        throw new BadRequestException('Invalid reset code');
      }

      verificationCode.is_verified = true;
      verificationCode.verified_at = new Date();
      await queryRunner.manager.save(verificationCode);

      const user = verificationCode.user;
      await this.userService.update(user.id, { password }, queryRunner.manager);

      // Invalidate all sessions for this user after password reset
      await queryRunner.manager.update(
        UserSessionEntity,
        { user: { id: user.id }, is_active: true },
        { is_active: false },
      );

      await queryRunner.commitTransaction();
      return { message: 'Password reset successfully' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
