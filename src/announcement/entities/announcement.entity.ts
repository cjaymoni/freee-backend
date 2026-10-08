import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

export enum AnnouncementLevel {
  INFO = 'info',
  WARNING = 'warning',
}

/**
 * A banner the apps show to everyone while it is live: switched on, and now
 * between `active_from` and `active_until` (open-ended when that's null).
 * Unlike a push, it reaches people with no device registered.
 */
@Entity('announcements')
@Index(['is_active', 'active_from'])
export class AnnouncementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 280 })
  message: string;

  @Column({ type: 'varchar', length: 20, default: AnnouncementLevel.INFO })
  level: AnnouncementLevel;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  active_from: Date;

  @Column({ type: 'timestamp', nullable: true })
  active_until: Date | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator: UserEntity | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
