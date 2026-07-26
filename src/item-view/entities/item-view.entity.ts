import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ItemEntity } from '../../item/entities/item.entity';
import { UserEntity } from '../../user/entities/user.entity';

@Entity('item_views')
@Index(['item_id'])
@Index(['viewer_id'])
@Index(['created_at'])
@Index('idx_views_item_time', ['item_id', 'created_at'])
// One view per viewer per item; anonymous viewers are deduplicated by IP.
@Index('UQ_ITEM_VIEWS_ITEM_VIEWER', ['item_id', 'viewer_id'], {
  unique: true,
  where: 'viewer_id IS NOT NULL',
})
@Index('UQ_ITEM_VIEWS_ITEM_IP_ANON', ['item_id', 'ip_address'], {
  unique: true,
  where: 'viewer_id IS NULL',
})
export class ItemViewEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  item_id: string;

  @Column({ type: 'uuid', nullable: true })
  viewer_id: string | null;

  @Column({ type: 'varchar', length: 45 })
  ip_address: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  device_type: string | null;

  @Column({ type: 'text', nullable: true })
  referrer: string | null;

  @Column({ type: 'int', nullable: true })
  view_duration_seconds: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  // Relations
  @ManyToOne(() => ItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: ItemEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'viewer_id' })
  viewer: UserEntity;
}
