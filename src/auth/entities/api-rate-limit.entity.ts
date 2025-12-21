import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('api_rate_limits')
@Index(['ip_address'])
@Index(['endpoint'])
@Index('idx_rate_limit_user', ['user', 'endpoint', 'window_end'])
@Index('idx_rate_limit_ip', ['ip_address', 'endpoint', 'window_end'])
@Index(['window_end'])
export class ApiRateLimitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint: string;

  @Column({ type: 'int', default: 1 })
  request_count: number;

  @Column({ type: 'timestamp' })
  window_start: Date;

  @Column({ type: 'timestamp' })
  window_end: Date;

  @Column({ type: 'boolean', default: false })
  is_blocked: boolean;

  @Column({ type: 'timestamp', nullable: true })
  blocked_until: Date;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
