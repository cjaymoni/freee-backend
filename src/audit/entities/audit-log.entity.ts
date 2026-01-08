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

@Entity('audit_logs')
@Index(['user_id'])
@Index(['entity_type'])
@Index(['entity_id'])
@Index(['action'])
@Index(['created_at'])
@Index('idx_audit_entity', ['entity_type', 'entity_id', 'created_at'])
@Index('idx_audit_user_time', ['user_id', 'created_at'])
@Index('idx_audit_action', ['entity_type', 'action', 'created_at'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 50 })
  entity_type: string;

  @Column({ type: 'uuid' })
  entity_id: string;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'json', nullable: true })
  old_values: Record<string, any> | null;

  @Column({ type: 'json', nullable: true })
  new_values: Record<string, any> | null;

  @Column({ type: 'json', nullable: true })
  changed_fields: string[] | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  api_endpoint: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  request_method: string | null;

  @Column({ type: 'boolean', default: true })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;
}
