import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Back office endpoints, all under /admin. App-facing controllers stay free of
 * staff-only logic; each area of the back office gets its own controller here.
 */
@Module({
  imports: [UserModule],
  controllers: [AdminUsersController],
  providers: [AdminAuditService, AdminUsersService],
})
export class AdminModule {}
