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
import { ItemEntity } from '../../item/entities/item.entity';
import { UserEntity } from '../../user/entities/user.entity';

export enum RequestStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

@Entity('item_requests')
@Index(['item_id'])
@Index(['requester_id'])
@Index(['owner_id'])
@Index(['status'])
@Index(['created_at'])
// One active request per requester per item. Declared here as well as in the
// migration so that `synchronize` in development does not drop it.
@Index('UQ_ITEM_REQUESTS_ACTIVE_PER_REQUESTER', ['item_id', 'requester_id'], {
  unique: true,
  where: "status IN ('pending', 'confirmed')",
})
export class ItemRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  item_id: string;

  @Column({ type: 'uuid' })
  requester_id: string;

  @Column({ type: 'uuid' })
  owner_id: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: RequestStatus.PENDING,
  })
  status: RequestStatus;

  @Column({ type: 'timestamp', nullable: true })
  pickup_date: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  confirmation_code: string | null;

  @Column({ type: 'boolean', default: false })
  is_picked_up: boolean;

  @Column({ type: 'timestamp', nullable: true })
  picked_up_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelled_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  cancelled_by: string | null;

  @Column({ type: 'text', nullable: true })
  cancellation_reason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // Relations
  @ManyToOne(() => ItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: ItemEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requester_id' })
  requester: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cancelled_by' })
  cancelledByUser: UserEntity;
}
