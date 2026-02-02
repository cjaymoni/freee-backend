import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('blocked_users')
@Index(['blockerId'])
@Index(['blockedId'])
@Index(['blockerId', 'blockedId', 'isDeleted'], { unique: true })
export class BlockedUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'blocker_id', type: 'uuid' })
  blockerId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'blocker_id' })
  blocker: UserEntity;

  @Column({ name: 'blocked_id', type: 'uuid' })
  blockedId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'blocked_id' })
  blocked: UserEntity;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
