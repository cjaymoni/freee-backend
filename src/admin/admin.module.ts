import { NotificationModule } from '../notification/notification.module';
import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { ChatModule } from '../chat/chat.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { AdminAnnouncementsController } from './admin-announcements.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminInboxController } from './admin-inbox.controller';
import { AdminItemsController } from './admin-items.controller';
import { AdminItemsService } from './admin-items.service';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminRequestsController } from './admin-requests.controller';
import { AdminRequestsService } from './admin-requests.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

/**
 * Back office endpoints, all under /admin. App-facing controllers stay free of
 * staff-only logic; each area of the back office gets its own controller here.
 * Services read through the DataSource, so no forFeature list is needed.
 */
@Module({
  imports: [UserModule, ChatModule, NotificationModule, AnnouncementModule],
  controllers: [
    AdminUsersController,
    AdminItemsController,
    AdminRequestsController,
    AdminNotificationsController,
    AdminInboxController,
    AdminAnnouncementsController,
  ],
  providers: [
    AdminAuditService,
    AdminUsersService,
    AdminItemsService,
    AdminRequestsService,
    AdminNotificationsService,
  ],
})
export class AdminModule {}
