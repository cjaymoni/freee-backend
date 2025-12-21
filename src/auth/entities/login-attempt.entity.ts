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

@Entity('login_attempts')
@Index(['phone_number'])
@Index(['ip_address'])
@Index(['created_at'])
@Index('idx_login_ip_time', ['ip_address', 'created_at'])
@Index('idx_login_user_time', ['user', 'created_at'])
export class LoginAttemptEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone_number: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 45 })
  ip_address: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  device_id: string;

  @Column({ type: 'text', nullable: true })
  user_agent: string;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'success, failed, blocked',
  })
  attempt_result: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'invalid_password, account_locked, account_not_found',
  })
  failure_reason: string;

  @Column({ type: 'json', nullable: true, comment: 'Country, city from IP' })
  geolocation: any;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
