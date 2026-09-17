import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { UserEntity } from '../../user/entities/user.entity';
import { ItemEntity } from '../../item/entities/item.entity';

/**
 * A single thread between two users.
 *
 * There is exactly one conversation per pair of users, for all time. The pair
 * is stored canonically - `user_a_id` always holds the lexicographically
 * smaller UUID - so that (a, b) and (b, a) collapse onto the same row and the
 * unique index below can enforce "one thread per pair" without a second
 * lookup. Everything that resolves a side of the pair goes through
 * ChatService's `orderPair` / `sideOf` helpers rather than comparing ids
 * ad hoc.
 *
 * `item_id` is context, not identity: a thread usually starts from an item,
 * and re-opening the same pair from a different item re-points this column at
 * the newer item rather than starting a second thread. It is what the client
 * renders in the banner above the message list.
 */
@Entity('conversations')
// Index and constraint names are pinned to the ones the migration creates.
// Left unnamed, TypeORM derives hashed names, does not recognise the migration's
// as its own, and `synchronize` in development drops and recreates all of them.
@Index('IDX_conversations_user_a', ['user_a_id'])
@Index('IDX_conversations_user_b', ['user_b_id'])
@Index('IDX_conversations_item', ['item_id'])
@Index('IDX_conversations_last_message_at', ['last_message_at'])
// Declared here as well as in the migration so that `synchronize` in
// development does not drop it.
@Index('UQ_CONVERSATIONS_PAIR', ['user_a_id', 'user_b_id'], { unique: true })
// Likewise: the pair-order invariant the class comment relies on. TypeORM knows
// a check constraint only if the entity declares it, and drops the ones it does
// not know.
@Check('CHK_CONVERSATIONS_PAIR_ORDER', '"user_a_id" < "user_b_id"')
export class ConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The smaller of the two participant UUIDs. See the class comment. */
  @Column({ type: 'uuid' })
  user_a_id: string;

  /** The larger of the two participant UUIDs. See the class comment. */
  @Column({ type: 'uuid' })
  user_b_id: string;

  /** The item this thread is currently about, if any. */
  @Column({ type: 'uuid', nullable: true })
  item_id: string | null;

  // Denormalised summary of the newest message, so that the chat list can be
  // ordered and rendered without joining or aggregating chat_messages. Written
  // in the same transaction as the message itself.

  @Column({ type: 'timestamp', nullable: true })
  last_message_at: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  last_message_preview: string | null;

  @Column({ type: 'uuid', nullable: true })
  last_message_sender_id: string | null;

  // Per-side read state. Counters are incremented for the recipient and reset
  // on read, both inside the transaction that writes the message, so they
  // cannot drift from chat_messages.read_at as long as every write goes
  // through ChatService.

  @Column({ type: 'int', default: 0 })
  user_a_unread_count: number;

  @Column({ type: 'int', default: 0 })
  user_b_unread_count: number;

  @Column({ type: 'timestamp', nullable: true })
  user_a_last_read_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  user_b_last_read_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // Relations
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_a_id',
    foreignKeyConstraintName: 'FK_conversations_user_a',
  })
  userA: UserEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_b_id',
    foreignKeyConstraintName: 'FK_conversations_user_b',
  })
  userB: UserEntity;

  @ManyToOne(() => ItemEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'item_id',
    foreignKeyConstraintName: 'FK_conversations_item',
  })
  item: ItemEntity | null;
}
