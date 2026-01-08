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
  OneToOne,
} from 'typeorm';
import { UserSessionEntity } from '../../auth/entities/user-session.entity';
import { LocationEntity } from './location.entity';
import { UserPreferenceEntity } from './user-preference.entity';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

@Entity('users')
@Index(['created_at'])
@Index('idx_users_active', ['is_active', 'is_deleted', 'last_active'])
@Index('idx_users_soft_delete', ['is_deleted', 'deleted_at'])
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  phone_number: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 128, unique: true, nullable: true })
  @Index('idx_users_firebase_uid')
  firebase_uid: string;

  @Column({ type: 'boolean', default: false })
  is_onboarded: boolean;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'bcrypt with 12 rounds',
  })
  password_hash: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  first_name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  last_name: string;

  @Column({ type: 'date', nullable: true })
  date_of_birth: Date;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gender: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cloudinary_avatar_public_id: string;

  @Column({ type: 'text', nullable: true })
  cloudinary_avatar_url: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  member_since: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_active: Date;

  @Column({ type: 'boolean', default: false })
  is_email_verified: boolean;

  @Column({ type: 'boolean', default: false })
  is_phone_verified: boolean;

  @Column({ type: 'text', nullable: true })
  fcm_token: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: true })
  notification_enabled: boolean;

  @Column({ type: 'int', default: 0 })
  failed_login_attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  account_locked_until: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_password_change: Date;

  @Column({ type: 'boolean', default: false })
  requires_password_change: boolean;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'deleted_by' })
  deleted_by: UserEntity;

  @Column({ type: 'text', nullable: true })
  deletion_reason: string;

  @OneToMany(() => UserSessionEntity, (session) => session.user)
  sessions: UserSessionEntity[];

  @OneToMany(() => LocationEntity, (location) => location.user)
  locations: LocationEntity[];

  @OneToOne(() => UserPreferenceEntity, (preference) => preference.user)
  preference: UserPreferenceEntity;
}
