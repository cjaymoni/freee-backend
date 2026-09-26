import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { ChatModule } from '../chat/chat.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminItemsController } from './admin-items.controller';
import { AdminItemsService } from './admin-items.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Back office endpoints, all under /admin. App-facing controllers stay free of
 * staff-only logic; each area of the back office gets its own controller here.
 * Services read through the DataSource, so no forFeature list is needed.
 */
@Module({
  imports: [UserModule, ChatModule],
  controllers: [AdminUsersController, AdminItemsController],
  providers: [AdminAuditService, AdminUsersService, AdminItemsService],
})
export class AdminModule {}
