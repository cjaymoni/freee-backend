import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';

/**
 * One platform setting staff have changed from its default. Keys not in this
 * table fall back to the default in settings.registry.ts, so the table is
 * empty on a fresh install and only grows as values are tuned.
 *
 * The value is kept as text and parsed against the registry on read: the
 * registry owns the type and the range, not the column.
 */
@Entity('platform_settings')
export class PlatformSettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'uuid', nullable: true })
  updated_by: string | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  editor: UserEntity | null;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
