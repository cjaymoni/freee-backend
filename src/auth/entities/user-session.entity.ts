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

@Entity('user_sessions')
@Index(['session_token'])
@Index(['user', 'is_active'])
@Index(['expires_at'])
@Index('idx_sessions_cleanup', ['is_active', 'last_activity'])
export class UserSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 255, unique: true })
  session_token: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  device_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  device_name: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'ios, android, web',
  })
  device_type: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string;

  @Column({ type: 'text', nullable: true })
  user_agent: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Firebase Cloud Messaging for push notifications',
  })
  fcm_token: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  last_activity: Date;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
