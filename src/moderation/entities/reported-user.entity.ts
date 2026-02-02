import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('reported_users')
@Index(['reportedUserId'])
@Index(['reporterId'])
@Index(['status'])
@Index(['status', 'priority', 'createdAt'])
export class ReportedUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reported_user_id', type: 'uuid' })
  reportedUserId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'reported_user_id' })
  reportedUser: UserEntity;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'reporter_id' })
  reporter: UserEntity;

  @Column({ type: 'varchar', length: 100 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'varchar', length: 20, default: 'medium' })
  priority: string;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: UserEntity;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string;

  @Column({ name: 'action_taken', type: 'varchar', length: 100, nullable: true })
  actionTaken: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date;
}
