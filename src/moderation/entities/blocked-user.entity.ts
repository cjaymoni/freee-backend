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
// One active block per pair; unblocked (soft-deleted) rows may repeat.
// Declared here as well as in the migration so that `synchronize` in
// development does not drop it.
@Index('UQ_BLOCKED_USERS_ACTIVE_PAIR', ['blockerId', 'blockedId'], {
  unique: true,
  where: 'is_deleted = false',
})
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
