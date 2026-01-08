import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { LocationEntity } from '../../user/entities/location.entity';
import { CategoryEntity } from '../../category/entities/category.entity';
import { ItemImageEntity } from './item-image.entity';

export enum ItemCondition {
  NEW = 'new',
  LIKE_NEW = 'like_new',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
}

export enum ItemStatus {
  AVAILABLE = 'available',
  RESERVED = 'reserved',
  PICKED_UP = 'picked_up',
  UNAVAILABLE = 'unavailable',
}

@Entity('items')
@Index(['user_id'])
@Index(['category_id'])
@Index(['status'])
@Index(['created_at'])
@Index(['location_id'])
@Index('idx_items_status_created', ['status', 'is_deleted', 'created_at'])
@Index('idx_items_cat_status', [
  'category_id',
  'status',
  'is_deleted',
  'created_at',
])
@Index('idx_items_featured', [
  'is_featured',
  'status',
  'is_deleted',
  'featured_until',
])
@Index('idx_items_soft_delete', ['is_deleted', 'deleted_at'])
export class ItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'uuid', nullable: true })
  category_id: string;

  @ManyToOne(() => CategoryEntity, (category) => category.items, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  category: CategoryEntity;

  @Column({
    type: 'enum',
    enum: ItemCondition,
  })
  condition: ItemCondition;

  @Column({
    type: 'enum',
    enum: ItemStatus,
    default: ItemStatus.AVAILABLE,
  })
  status: ItemStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  @Column({ type: 'boolean', default: true })
  is_free: boolean;

  @Column({ type: 'int', default: 0 })
  view_count: number;

  // Reference to the centralized location table
  @Column({ type: 'uuid', nullable: true })
  location_id: string;

  @ManyToOne(() => LocationEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'location_id' })
  location: LocationEntity;

  @Column({ type: 'date', nullable: true })
  pickup_date: Date | null;

  @Column({ type: 'boolean', default: false })
  is_featured: boolean;

  @Column({ type: 'timestamp', nullable: true })
  featured_until: Date | null;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deleted_by: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deleted_by' })
  deletedByUser: UserEntity;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deletion_reason: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => ItemImageEntity, (image) => image.item)
  images: ItemImageEntity[];

  // TODO: Add ItemReportEntity relation when reports module is created
  // @OneToMany(() => ItemReportEntity, (report) => report.item)
  // reports: ItemReportEntity[];
}
