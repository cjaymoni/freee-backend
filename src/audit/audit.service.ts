import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';

export interface AuditLogData {
  userId?: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  apiEndpoint?: string;
  requestMethod?: string;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
  ) {}

  /**
   * Log an audit event
   */
  async log(data: AuditLogData): Promise<void> {
    try {
      const changedFields = this.getChangedFields(
        data.oldValues,
        data.newValues,
      );

      const auditLog = this.auditLogRepository.create({
        user_id: data.userId || null,
        entity_type: data.entityType,
        entity_id: data.entityId,
        action: data.action,
        old_values: data.oldValues || null,
        new_values: data.newValues || null,
        changed_fields: changedFields.length > 0 ? changedFields : null,
        ip_address: data.ipAddress || null,
        user_agent: data.userAgent || null,
        api_endpoint: data.apiEndpoint || null,
        request_method: data.requestMethod || null,
        success: data.success !== undefined ? data.success : true,
        error_message: data.errorMessage || null,
        metadata: data.metadata || null,
      });

      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      // Log to console but don't throw - auditing should never break the app
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Get changed fields between old and new values
   */
  private getChangedFields(
    oldValues?: Record<string, any>,
    newValues?: Record<string, any>,
  ): string[] {
    if (!oldValues || !newValues) {
      return [];
    }

    const changed: string[] = [];
    const allKeys = new Set([
      ...Object.keys(oldValues),
      ...Object.keys(newValues),
    ]);

    for (const key of allKeys) {
      if (JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key])) {
        changed.push(key);
      }
    }

    return changed;
  }

  /**
   * Query audit logs with filters
   */
  async findAll(filters: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLogEntity[]; total: number }> {
    const query = this.auditLogRepository.createQueryBuilder('audit');

    if (filters.userId) {
      query.andWhere('audit.user_id = :userId', { userId: filters.userId });
    }

    if (filters.entityType) {
      query.andWhere('audit.entity_type = :entityType', {
        entityType: filters.entityType,
      });
    }

    if (filters.entityId) {
      query.andWhere('audit.entity_id = :entityId', {
        entityId: filters.entityId,
      });
    }

    if (filters.action) {
      query.andWhere('audit.action = :action', { action: filters.action });
    }

    if (filters.startDate) {
      query.andWhere('audit.created_at >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      query.andWhere('audit.created_at <= :endDate', {
        endDate: filters.endDate,
      });
    }

    query.orderBy('audit.created_at', 'DESC');

    const total = await query.getCount();

    if (filters.limit) {
      query.limit(filters.limit);
    }

    if (filters.offset) {
      query.offset(filters.offset);
    }

    const logs = await query.getMany();

    return { logs, total };
  }

  /**
   * Get audit history for a specific entity
   */
  async getEntityHistory(
    entityType: string,
    entityId: string,
  ): Promise<AuditLogEntity[]> {
    return this.auditLogRepository.find({
      where: {
        entity_type: entityType,
        entity_id: entityId,
      },
      order: {
        created_at: 'DESC',
      },
    });
  }
}
