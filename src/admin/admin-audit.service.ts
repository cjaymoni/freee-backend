import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuditEntityType, AuditMetadataKey } from '../audit/audit.constants';
import { UserRole } from '../user/entities/user.entity';

export interface StaffActor {
  userId: string;
  role: UserRole;
}

/**
 * Records every back office write in the audit log, so the Audit page can
 * answer who changed what and when. Admin services call this once per change,
 * after it has been committed.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly auditService: AuditService) {}

  async record(params: {
    /** null for changes the system makes on its own, e.g. a suspension ending. */
    actor: StaffActor | null;
    entityType: AuditEntityType;
    entityId: string;
    action: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    reason?: string;
    request?: Request;
  }): Promise<void> {
    await this.auditService.log({
      userId: params.actor?.userId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      oldValues: params.oldValues,
      newValues: params.newValues,
      ipAddress: params.request?.ip,
      userAgent: params.request?.headers['user-agent'],
      apiEndpoint: params.request?.originalUrl,
      requestMethod: params.request?.method,
      metadata: {
        backoffice: true,
        [AuditMetadataKey.USER_ROLE]: params.actor?.role ?? 'system',
        ...(params.reason && { [AuditMetadataKey.REASON]: params.reason }),
      },
    });
  }
}
