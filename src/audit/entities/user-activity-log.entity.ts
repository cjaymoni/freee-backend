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
import { UserSessionEntity } from '../../auth/entities/user-session.entity';

@Entity('user_activity_log')
@Index(['user_id'])
@Index(['activity_type'])
@Index(['created_at'])
@Index(['session_id'])
@Index('idx_activity_user', ['user_id', 'activity_type', 'created_at'])
@Index('idx_activity_type', ['activity_type', 'created_at'])
export class UserActivityLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 50 })
  activity_type: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  resource_type: string | null;

  @Column({ type: 'uuid', nullable: true })
  resource_id: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  device_type: string | null;

  @Column({ type: 'uuid', nullable: true })
  session_id: string | null;

  @ManyToOne(() => UserSessionEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'session_id' })
  session: UserSessionEntity;

  @Column({ type: 'int', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;
}
