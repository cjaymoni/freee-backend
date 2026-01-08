import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SystemEventType {
  SCHEDULED_JOB = 'scheduled_job',
  BATCH_PROCESS = 'batch_process',
  SYSTEM_ALERT = 'system_alert',
}

export enum SystemEventStatus {
  STARTED = 'started',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('system_events')
@Index(['event_type'])
@Index(['status'])
@Index(['created_at'])
@Index('idx_system_event_composite', ['event_type', 'status', 'created_at'])
export class SystemEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: SystemEventType })
  event_type: SystemEventType;

  @Column({ type: 'varchar', length: 100 })
  event_name: string;

  @Column({ type: 'enum', enum: SystemEventStatus })
  status: SystemEventStatus;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', nullable: true })
  affected_records: number | null;

  @Column({ type: 'int', nullable: true })
  duration_ms: number | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;
}
