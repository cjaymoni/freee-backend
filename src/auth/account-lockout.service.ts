import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AccountLockoutService {
  private readonly maxAttempts: number;
  private readonly lockoutDuration: number; // in minutes

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly configService: ConfigService,
  ) {
    this.maxAttempts = this.configService.get<number>('MAX_LOGIN_ATTEMPTS', 5);
    this.lockoutDuration = this.configService.get<number>(
      'LOCKOUT_DURATION_MINUTES',
      30,
    );
  }

  async isAccountLocked(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return false;

    if (user.account_locked_until && user.account_locked_until > new Date()) {
      return true;
    }

    // Auto-unlock if lockout period has passed
    if (user.account_locked_until && user.account_locked_until <= new Date()) {
      await this.unlockAccount(userId);
      return false;
    }

    return false;
  }

  async recordFailedAttempt(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return;

    user.failed_login_attempts += 1;

    if (user.failed_login_attempts >= this.maxAttempts) {
      const lockoutUntil = new Date();
      lockoutUntil.setMinutes(lockoutUntil.getMinutes() + this.lockoutDuration);
      user.account_locked_until = lockoutUntil;
    }

    await this.userRepository.save(user);
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      failed_login_attempts: 0,
      account_locked_until: undefined,
    });
  }

  async unlockAccount(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      failed_login_attempts: 0,
      account_locked_until: undefined,
    });
  }

  async getRemainingLockoutTime(userId: string): Promise<number | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.account_locked_until) return null;

    const now = new Date();
    if (user.account_locked_until <= now) return null;

    return Math.ceil(
      (user.account_locked_until.getTime() - now.getTime()) / 1000 / 60,
    );
  }
}
