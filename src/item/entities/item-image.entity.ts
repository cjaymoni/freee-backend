import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ItemEntity } from './item.entity';

@Entity('item_images')
@Index(['item_id'])
@Index(['display_order'])
@Index(['cloudinary_public_id'], { unique: true })
@Index('idx_item_images_item_deleted', ['item_id', 'is_deleted'])
export class ItemImageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  item_id: string;

  @ManyToOne(() => ItemEntity, (item) => item.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: ItemEntity;

  @Column({ type: 'varchar', length: 255 })
  cloudinary_public_id: string;

  @Column({ type: 'text' })
  cloudinary_url: string;

  @Column({ type: 'text' })
  cloudinary_secure_url: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  cloudinary_format: string | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'int', nullable: true })
  size_bytes: number | null;

  @Column({ type: 'int', default: 0 })
  display_order: number;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
