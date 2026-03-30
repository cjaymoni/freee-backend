import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SystemEventEntity,
  SystemEventType,
  SystemEventStatus,
} from './entities/system-event.entity';

export interface SystemEventData {
  eventType: SystemEventType;
  eventName: string;
  status: SystemEventStatus;
  description?: string;
  affectedRecords?: number;
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class SystemEventService {
  constructor(
    @InjectRepository(SystemEventEntity)
    private readonly systemEventRepository: Repository<SystemEventEntity>,
  ) {}

  /**
   * Log a system event
   */
  async log(data: SystemEventData): Promise<SystemEventEntity> {
    const event = this.systemEventRepository.create({
      event_type: data.eventType,
      event_name: data.eventName,
      status: data.status,
      description: data.description,
      affected_records: data.affectedRecords,
      duration_ms: data.durationMs,
      error_message: data.errorMessage,
      metadata: data.metadata,
    });
    return this.systemEventRepository.save(event);
  }

  /**
   * Start tracking a system event
   */
  async startEvent(
    eventType: SystemEventType,
    eventName: string,
    description?: string,
  ): Promise<SystemEventEntity> {
    return this.log({
      eventType,
      eventName,
      status: SystemEventStatus.STARTED,
      description,
    });
  }

  /**
   * Mark event as completed
   */
  async completeEvent(
    eventId: string,
    affectedRecords?: number,
    durationMs?: number,
  ): Promise<void> {
    await this.systemEventRepository.update(eventId, {
      status: SystemEventStatus.COMPLETED,
      affected_records: affectedRecords,
      duration_ms: durationMs,
    });
  }

  /**
   * Mark event as failed
   */
  async failEvent(
    eventId: string,
    errorMessage: string,
    durationMs?: number,
  ): Promise<void> {
    await this.systemEventRepository.update(eventId, {
      status: SystemEventStatus.FAILED,
      error_message: errorMessage,
      duration_ms: durationMs,
    });
  }

  /**
   * Query system events
   */
  async findAll(filters: {
    eventType?: SystemEventType;
    status?: SystemEventStatus;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<SystemEventEntity[]> {
    const query = this.systemEventRepository.createQueryBuilder('event');

    if (filters.eventType) {
      query.andWhere('event.event_type = :eventType', {
        eventType: filters.eventType,
      });
    }

    if (filters.status) {
      query.andWhere('event.status = :status', { status: filters.status });
    }

    if (filters.startDate) {
      query.andWhere('event.created_at >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      query.andWhere('event.created_at <= :endDate', {
        endDate: filters.endDate,
      });
    }

    query.orderBy('event.created_at', 'DESC');

    if (filters.limit) {
      query.limit(filters.limit);
    }

    return query.getMany();
  }
}
