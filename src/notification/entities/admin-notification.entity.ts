import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

export enum NotificationAudience {
  ALL = 'all',
  USER = 'user',
  LOCATION = 'location',
  FOUNDING_FREERS = 'founding_freers',
}

export enum AdminNotificationStatus {
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
}

/** Who a notification went to, as staff picked it. */
export interface AudienceFilter {
  type: NotificationAudience;
  user_id?: string;
  city?: string;
  region?: string;
}

/**
 * An announcement staff sent from the back office, and how its delivery
 * went. The counts fill in as it goes out, so a large send can be watched.
 */
@Entity('notifications')
@Index(['created_at'])
export class AdminNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  @Column({ type: 'boolean', default: false })
  send_email: boolean;

  @Column({ type: 'jsonb' })
  audience: AudienceFilter;

  @Column({
    type: 'varchar',
    length: 20,
    default: AdminNotificationStatus.SENDING,
  })
  status: AdminNotificationStatus;

  /** Users the audience matched when it was sent. */
  @Column({ type: 'int', default: 0 })
  recipient_count: number;

  /** Users at least one of whose devices got the push. */
  @Column({ type: 'int', default: 0 })
  push_sent_count: number;

  @Column({ type: 'int', default: 0 })
  email_sent_count: number;

  /** Users nothing reached because a send failed, not because of their settings. */
  @Column({ type: 'int', default: 0 })
  failure_count: number;

  @Column({ type: 'uuid', nullable: true })
  sent_by: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sent_by' })
  sender: UserEntity | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date | null;
}
