import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserActivityLogEntity } from './entities/user-activity-log.entity';

export interface UserActivityData {
  userId: string;
  activityType: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  deviceType?: string;
  sessionId?: string;
  durationSeconds?: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class UserActivityService {
  constructor(
    @InjectRepository(UserActivityLogEntity)
    private readonly activityLogRepository: Repository<UserActivityLogEntity>,
  ) {}

  /**
   * Log a user activity
   */
  async log(data: UserActivityData): Promise<void> {
    try {
      const activity = this.activityLogRepository.create({
        user_id: data.userId,
        activity_type: data.activityType,
        resource_type: data.resourceType || null,
        resource_id: data.resourceId || null,
        ip_address: data.ipAddress || null,
        device_type: data.deviceType || null,
        session_id: data.sessionId || null,
        duration_seconds: data.durationSeconds || null,
        metadata: data.metadata || null,
      });

      await this.activityLogRepository.save(activity);
    } catch (error) {
      console.error('Failed to log user activity:', error);
    }
  }

  /**
   * Get user activity history
   */
  async getUserActivity(
    userId: string,
    filters?: {
      activityType?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
  ): Promise<UserActivityLogEntity[]> {
    const query = this.activityLogRepository
      .createQueryBuilder('activity')
      .where('activity.user_id = :userId', { userId });

    if (filters?.activityType) {
      query.andWhere('activity.activity_type = :activityType', {
        activityType: filters.activityType,
      });
    }

    if (filters?.startDate) {
      query.andWhere('activity.created_at >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters?.endDate) {
      query.andWhere('activity.created_at <= :endDate', {
        endDate: filters.endDate,
      });
    }

    query.orderBy('activity.created_at', 'DESC');

    if (filters?.limit) {
      query.limit(filters.limit);
    }

    return query.getMany();
  }

  /**
   * Get activity analytics
   */
  async getActivityStats(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ activityType: string; count: number }[]> {
    return this.activityLogRepository
      .createQueryBuilder('activity')
      .select('activity.activity_type', 'activityType')
      .addSelect('COUNT(*)', 'count')
      .where('activity.user_id = :userId', { userId })
      .andWhere('activity.created_at >= :startDate', { startDate })
      .andWhere('activity.created_at <= :endDate', { endDate })
      .groupBy('activity.activity_type')
      .orderBy('count', 'DESC')
      .getRawMany();
  }
}
