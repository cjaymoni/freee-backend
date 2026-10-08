import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/entities/user.entity';
import { UserPreferenceEntity } from '../user/entities/user-preference.entity';
import { UserSessionEntity } from '../auth/entities/user-session.entity';
import { MailModule } from '../mail/mail.module';
import { NotificationService } from './notification.service';
import { AdminNotificationEntity } from './entities/admin-notification.entity';
import { StaffNotificationEntity } from './entities/staff-notification.entity';
import { StaffInboxService } from './staff-inbox.service';

/**
 * Depends only on entities, Firebase (global) and mail, so any feature
 * module can import it without creating a cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserPreferenceEntity,
      UserSessionEntity,
      AdminNotificationEntity,
      StaffNotificationEntity,
    ]),
    MailModule,
  ],
  providers: [NotificationService, StaffInboxService],
  exports: [NotificationService, StaffInboxService],
})
export class NotificationModule {}
