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
import { UserEntity } from '../../user/entities/user.entity';
import { ConversationEntity } from './conversation.entity';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  /** Emitted by the backend when something happens to the shared item. */
  SYSTEM = 'system',
}

/**
 * What a SYSTEM message is reporting. The client picks the wording from this
 * plus the viewer's side, so the two parties can render one row differently
 * ("You've requested for Ivan's item!" / "Adjoa has requested for your item!")
 * without the backend storing two copies of it.
 */
export enum SystemEvent {
  ITEM_REQUESTED = 'item_requested',
  REQUEST_CONFIRMED = 'request_confirmed',
  REQUEST_CANCELLED = 'request_cancelled',
  PICKUP_CONFIRMED = 'pickup_confirmed',
}

/**
 * One message in a conversation.
 *
 * System messages are stored exactly like human ones, with `sender_id` set to
 * whoever caused the event and `recipient_id` to the other party. That keeps a
 * single ordering, unread-counting and read-receipt path for every row, and it
 * is what lets the same row render from both perspectives - see
 * {@link SystemEvent}.
 *
 * `recipient_id` is denormalised from the conversation so that unread counts
 * and read receipts are a single indexed predicate rather than a join plus a
 * side-of-the-pair comparison.
 */
@Entity('chat_messages')
@Index(['conversation_id'])
@Index(['sender_id'])
// Drives message pagination, which pages backwards through
// (created_at, id) within one conversation.
@Index('IDX_CHAT_MESSAGES_CONVERSATION_CURSOR', [
  'conversation_id',
  'created_at',
  'id',
])
// Drives the unread counts and the mark-as-read update.
@Index('IDX_CHAT_MESSAGES_UNREAD', ['recipient_id', 'read_at'])
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversation_id: string;

  /** For SYSTEM messages, the user whose action triggered the event. */
  @Column({ type: 'uuid' })
  sender_id: string;

  /** The other participant. Denormalised - see the class comment. */
  @Column({ type: 'uuid' })
  recipient_id: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: MessageType.TEXT,
  })
  message_type: MessageType;

  /** Null for image-only messages and for system messages. */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  system_event: SystemEvent | null;

  /**
   * Snapshot of what the system message refers to - item id, title, image and
   * the originating request id. Snapshotted rather than joined so the card
   * still renders correctly after the item is edited or deleted.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  image_url: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  image_public_id: string | null;

  @Column({ type: 'int', nullable: true })
  image_width: number | null;

  @Column({ type: 'int', nullable: true })
  image_height: number | null;

  @Column({ type: 'timestamp', nullable: true })
  read_at: Date | null;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // Relations
  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_id' })
  recipient: UserEntity;
}
