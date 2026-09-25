import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { UserEntity, UserRole } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { AuditEntityType } from '../audit/audit.constants';
import { AppError } from '../common/app-error';
import { ServiceResponseDto } from '../common/service-response.dto';
import { UserResponseDto } from '../user/dto/user-response.dto';
import { AdminAuditService, StaffActor } from './admin-audit.service';

export const ROLE_CHANGED = 'role_changed';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly userService: UserService,
    private readonly adminAudit: AdminAuditService,
  ) {}

  async changeRole(
    actor: StaffActor,
    userId: string,
    role: UserRole,
    reason?: string,
    request?: Request,
  ): Promise<ServiceResponseDto<UserResponseDto>> {
    // Only admins reach this, and an admin can't change their own role, so
    // demoting another admin always leaves at least one (the actor).
    if (userId === actor.userId) {
      throw new AppError(
        new ForbiddenException('You cannot change your own role'),
      );
    }

    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: userId, is_deleted: false } });
    if (!user) {
      throw new AppError(new NotFoundException('User not found'));
    }
    if (user.role === role) {
      throw new AppError(
        new BadRequestException(`User already has the ${role} role`),
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const updated = await this.userService.update(userId, { role }, manager);
      // The role travels in the access token, so end every session: the user
      // signs in again and gets a token carrying the new role.
      await manager.update(
        UserSessionEntity,
        { user: { id: userId }, is_active: true },
        { is_active: false },
      );
      return updated;
    });

    await this.adminAudit.record({
      actor,
      entityType: AuditEntityType.USERS,
      entityId: userId,
      action: ROLE_CHANGED,
      oldValues: { role: user.role },
      newValues: { role },
      reason,
      request,
    });

    return { ...result, message: 'Role updated; the user must sign in again' };
  }
}
