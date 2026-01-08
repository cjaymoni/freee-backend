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
import { ItemEntity } from '../../item/entities/item.entity';

@Entity('categories')
@Index(['slug'])
@Index(['parent_category_id'])
@Index('idx_categories_active', ['is_active', 'is_deleted'])
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  icon_url: string | null;

  @Column({ type: 'uuid', nullable: true })
  parent_category_id: string | null;

  @ManyToOne(() => CategoryEntity, (category) => category.subcategories, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_category_id' })
  parentCategory: CategoryEntity;

  @OneToMany(() => CategoryEntity, (category) => category.parentCategory)
  subcategories: CategoryEntity[];

  @Column({ type: 'int', nullable: true })
  display_order: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => ItemEntity, (item) => item.category)
  items: ItemEntity[];
}
