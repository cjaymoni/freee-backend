import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
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
// Drives the pickup reminder job. It is an expression index on
// COALESCE(pickup_reminded_at, pickup_marked_at), which a decorator cannot
// describe, so it lives in AddPickupConfirmation alone; declaring the name
// with synchronize off stops `synchronize` from dropping it.
@Index('IDX_item_requests_pickup_awaiting', { synchronize: false })
// A mark always has a time. The reverse is allowed: deleting the marker's
// account nulls pickup_marked_by through its foreign key and leaves the time.
@Check(
  'CHK_item_requests_pickup_mark_has_time',
  '"pickup_marked_by" IS NULL OR "pickup_marked_at" IS NOT NULL',
)
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

  /** Wrong pickup codes submitted against the current code. */
  @Column({ type: 'int', default: 0 })
  pickup_attempts: number;

  /** When the locked-out requester last asked the owner for a new code. */
  @Column({ type: 'timestamp', nullable: true })
  pickup_code_requested_at: Date | null;

  /**
   * The party who tapped "Picked up" and is waiting for the other to confirm.
   * Null when nobody has, or after the other party declined. A pickup only
   * completes once both sides have said so.
   */
  @Column({ type: 'uuid', nullable: true })
  pickup_marked_by: string | null;

  @Column({ type: 'timestamp', nullable: true })
  pickup_marked_at: Date | null;

  /**
   * When the party who still has to confirm was last nudged: by the reminder
   * job, or by the marker tapping "Picked up" again. The next timed reminder
   * is a full interval after this.
   */
  @Column({ type: 'timestamp', nullable: true })
  pickup_reminded_at: Date | null;

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

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'pickup_marked_by',
    foreignKeyConstraintName: 'FK_item_requests_pickup_marked_by',
  })
  pickupMarkedByUser: UserEntity | null;
}
