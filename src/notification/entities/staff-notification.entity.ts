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

export enum StaffNotificationType {
  ITEM_REPORTED = 'item_reported',
  USER_REPORTED = 'user_reported',
  COMPLAINT_RECEIVED = 'complaint_received',
  LISTING_AWAITING_REVIEW = 'listing_awaiting_review',
  ROLE_CHANGED = 'role_changed',
  /** Someone else closed a report or complaint this person had in review. */
  TAKEN_OVER = 'taken_over',
}

/**
 * One entry in a staff member's back office inbox: something that happened
 * that they should know about. Each person has their own copy, so reading
 * one is personal.
 */
@Entity('staff_notifications')
@Index(['user_id', 'created_at'])
@Index(['user_id', 'read_at'])
export class StaffNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 40 })
  type: StaffNotificationType;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  body: string | null;

  /** Back office path to open, e.g. /reports/listings. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  link: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  read_at: Date | null;
}
