import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';
import { SystemEventEntity } from './entities/system-event.entity';
import { UserActivityLogEntity } from './entities/user-activity-log.entity';
import { AuditService } from './audit.service';
import { SystemEventService } from './system-event.service';
import { UserActivityService } from './user-activity.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { AuditHelperService } from './audit-helper.service';

// Export constants for use in other modules
export * from './audit.constants';
export {
  SystemEventType,
  SystemEventStatus,
} from './entities/system-event.entity';

@Global() // Make it global so other modules can easily inject audit services
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      SystemEventEntity,
      UserActivityLogEntity,
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    SystemEventService,
    UserActivityService,
    AuditInterceptor,
    AuditHelperService,
  ],
  exports: [
    AuditService,
    SystemEventService,
    UserActivityService,
    AuditInterceptor,
    AuditHelperService,
  ],
})
export class AuditModule {}
