import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat: one thread per pair of users, and the messages in it.
 *
 * `conversations` stores its pair canonically - user_a_id always the smaller
 * UUID - so that (a, b) and (b, a) address one row. The CHECK constraint is
 * what makes that an invariant rather than a convention the service happens
 * to follow, and the unique index on the pair is what makes "one thread per
 * pair" hold even when two devices open the same chat at once.
 *
 * The last-message and unread columns are denormalised from chat_messages so
 * that the chat list is a single indexed scan rather than a correlated
 * aggregate per row. ChatService writes them in the same transaction as the
 * message.
 */
export class CreateChatTables1788000000000 implements MigrationInterface {
  name = 'CreateChatTables1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_a_id" uuid NOT NULL,
        "user_b_id" uuid NOT NULL,
        "item_id" uuid,
        "last_message_at" TIMESTAMP,
        "last_message_preview" character varying(200),
        "last_message_sender_id" uuid,
        "user_a_unread_count" integer NOT NULL DEFAULT 0,
        "user_b_unread_count" integer NOT NULL DEFAULT 0,
        "user_a_last_read_at" TIMESTAMP,
        "user_b_last_read_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_CONVERSATIONS_PAIR_ORDER" CHECK ("user_a_id" < "user_b_id"),
        CONSTRAINT "FK_conversations_user_a" FOREIGN KEY ("user_a_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversations_user_b" FOREIGN KEY ("user_b_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversations_item" FOREIGN KEY ("item_id")
          REFERENCES "items"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_CONVERSATIONS_PAIR" ON "conversations" ("user_a_id", "user_b_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_user_a" ON "conversations" ("user_a_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_user_b" ON "conversations" ("user_b_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_item" ON "conversations" ("item_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_last_message_at" ON "conversations" ("last_message_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" uuid NOT NULL,
        "sender_id" uuid NOT NULL,
        "recipient_id" uuid NOT NULL,
        "message_type" character varying(20) NOT NULL DEFAULT 'text',
        "content" text,
        "system_event" character varying(40),
        "metadata" jsonb,
        "image_url" text,
        "image_public_id" character varying(255),
        "image_width" integer,
        "image_height" integer,
        "read_at" TIMESTAMP,
        "is_deleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_messages_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_messages_sender" FOREIGN KEY ("sender_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_messages_recipient" FOREIGN KEY ("recipient_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_conversation" ON "chat_messages" ("conversation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_sender" ON "chat_messages" ("sender_id")`,
    );
    // Serves the message pagination, which walks (created_at, id) backwards
    // within one conversation.
    await queryRunner.query(
      `CREATE INDEX "IDX_CHAT_MESSAGES_CONVERSATION_CURSOR" ON "chat_messages" ("conversation_id", "created_at", "id")`,
    );
    // Serves the unread counts and the mark-as-read update, both of which
    // filter on recipient_id with read_at IS NULL.
    await queryRunner.query(
      `CREATE INDEX "IDX_CHAT_MESSAGES_UNREAD" ON "chat_messages" ("recipient_id", "read_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // chat_messages first: its FK to conversations is ON DELETE CASCADE, so
    // dropping the parent first would fail.
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
  }
}
