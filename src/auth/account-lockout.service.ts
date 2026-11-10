import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

@Injectable()
export class AccountLockoutService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly settings: PlatformSettingsService,
  ) {}

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

    // Read per attempt, not once at startup, so raising or lowering the
    // threshold in the back office takes effect on the next sign-in.
    if (
      user.failed_login_attempts >= this.settings.get('auth.max_login_attempts')
    ) {
      const lockoutUntil = new Date();
      lockoutUntil.setMinutes(
        lockoutUntil.getMinutes() + this.settings.get('auth.lockout_minutes'),
      );
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
