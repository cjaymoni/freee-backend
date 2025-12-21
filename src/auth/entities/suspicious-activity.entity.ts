import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('suspicious_activities')
@Index(['ip_address'])
@Index(['activity_type'])
@Index(['severity'])
@Index(['is_resolved', 'created_at'])
@Index(['created_at'])
export class SuspiciousActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({
    type: 'varchar',
    length: 50,
    comment: 'brute_force, spam, scraping, unusual_location',
  })
  activity_type: string;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'low, medium, high, critical',
  })
  severity: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'json', nullable: true, comment: 'Additional context data' })
  metadata: any;

  @Column({ type: 'boolean', default: false })
  is_resolved: boolean;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at: Date;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'resolved_by' })
  resolved_by: UserEntity;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'account_locked, ip_blocked, warning_sent',
  })
  action_taken: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
