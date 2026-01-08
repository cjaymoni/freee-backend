import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { UserActivityService } from '../audit/user-activity.service';

/**
 * Helper service to standardize audit logging across the application
 */
@Injectable()
export class AuditHelperService {
  constructor(
    private readonly auditService: AuditService,
    private readonly userActivityService: UserActivityService,
  ) {}

  /**
   * Log a CRUD operation with automatic change detection
   */
  async logCrudOperation(params: {
    userId?: string;
    entityType: string;
    entityId: string;
    action: 'created' | 'updated' | 'deleted' | 'viewed';
    oldValues?: any;
    newValues?: any;
    request?: any;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.auditService.log({
      userId: params.userId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      oldValues: params.oldValues,
      newValues: params.newValues,
      ipAddress: params.request?.ip,
      userAgent: params.request?.headers?.['user-agent'],
      apiEndpoint: params.request?.url,
      requestMethod: params.request?.method,
      success: true,
      metadata: params.metadata,
    });
  }

  /**
   * Log a user activity (for analytics)
   */
  async logUserActivity(params: {
    userId: string;
    activityType: string;
    resourceType?: string;
    resourceId?: string;
    request?: any;
    sessionId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.userActivityService.log({
      userId: params.userId,
      activityType: params.activityType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      ipAddress: params.request?.ip,
      deviceType: this.detectDeviceType(
        params.request?.headers?.['user-agent'],
      ),
      sessionId: params.sessionId,
      metadata: params.metadata,
    });
  }

  /**
   * Log both audit and activity (for important user actions)
   */
  async logUserAction(params: {
    userId: string;
    entityType: string;
    entityId: string;
    action: string;
    activityType: string;
    oldValues?: any;
    newValues?: any;
    request?: any;
    sessionId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    // Log audit trail
    await this.logCrudOperation({
      userId: params.userId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action as any,
      oldValues: params.oldValues,
      newValues: params.newValues,
      request: params.request,
      metadata: params.metadata,
    });

    // Log user activity
    await this.logUserActivity({
      userId: params.userId,
      activityType: params.activityType,
      resourceType: params.entityType,
      resourceId: params.entityId,
      request: params.request,
      sessionId: params.sessionId,
      metadata: params.metadata,
    });
  }

  /**
   * Detect device type from user agent
   */
  private detectDeviceType(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;

    const ua = userAgent.toLowerCase();
    if (
      ua.includes('mobile') ||
      ua.includes('android') ||
      ua.includes('iphone')
    ) {
      return 'mobile';
    }
    if (ua.includes('tablet') || ua.includes('ipad')) {
      return 'tablet';
    }
    return 'desktop';
  }

  /**
   * Sanitize sensitive data before logging
   */
  sanitizeData(data: any): any {
    if (!data) return data;

    const sanitized = { ...data };
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'api_key',
      'access_token',
      'refresh_token',
    ];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Compare objects and return only changed fields
   */
  getChangedFields(
    oldValues: any,
    newValues: any,
  ): Record<string, { old: any; new: any }> {
    if (!oldValues || !newValues) return {};

    const changes: Record<string, { old: any; new: any }> = {};
    const allKeys = new Set([
      ...Object.keys(oldValues),
      ...Object.keys(newValues),
    ]);

    for (const key of allKeys) {
      if (JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key])) {
        changes[key] = {
          old: oldValues[key],
          new: newValues[key],
        };
      }
    }

    return changes;
  }
}
