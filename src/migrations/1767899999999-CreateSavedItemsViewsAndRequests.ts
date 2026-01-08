import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateSavedItemsViewsAndRequests1767899999999 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create saved_items table
    await queryRunner.createTable(
      new Table({
        name: 'saved_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'item_id',
            type: 'uuid',
          },
          {
            name: 'is_deleted',
            type: 'boolean',
            default: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
    );

    // Create indexes for saved_items
    await queryRunner.createIndex(
      'saved_items',
      new TableIndex({
        name: 'IDX_SAVED_ITEMS_USER',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'saved_items',
      new TableIndex({
        name: 'IDX_SAVED_ITEMS_ITEM',
        columnNames: ['item_id'],
      }),
    );

    await queryRunner.createIndex(
      'saved_items',
      new TableIndex({
        name: 'idx_saved_items_unique',
        columnNames: ['user_id', 'item_id', 'is_deleted'],
        isUnique: true,
      }),
    );

    // Create foreign keys for saved_items
    await queryRunner.createForeignKey(
      'saved_items',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'saved_items',
      new TableForeignKey({
        columnNames: ['item_id'],
        referencedTableName: 'items',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Create item_views table
    await queryRunner.createTable(
      new Table({
        name: 'item_views',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'item_id',
            type: 'uuid',
          },
          {
            name: 'viewer_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
          },
          {
            name: 'device_type',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'referrer',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'view_duration_seconds',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
    );

    // Create indexes for item_views
    await queryRunner.createIndex(
      'item_views',
      new TableIndex({
        name: 'IDX_ITEM_VIEWS_ITEM',
        columnNames: ['item_id'],
      }),
    );

    await queryRunner.createIndex(
      'item_views',
      new TableIndex({
        name: 'IDX_ITEM_VIEWS_VIEWER',
        columnNames: ['viewer_id'],
      }),
    );

    await queryRunner.createIndex(
      'item_views',
      new TableIndex({
        name: 'IDX_ITEM_VIEWS_CREATED',
        columnNames: ['created_at'],
      }),
    );

    await queryRunner.createIndex(
      'item_views',
      new TableIndex({
        name: 'idx_views_item_time',
        columnNames: ['item_id', 'created_at'],
      }),
    );

    // Create foreign keys for item_views
    await queryRunner.createForeignKey(
      'item_views',
      new TableForeignKey({
        columnNames: ['item_id'],
        referencedTableName: 'items',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'item_views',
      new TableForeignKey({
        columnNames: ['viewer_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Create item_requests table
    await queryRunner.createTable(
      new Table({
        name: 'item_requests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'item_id',
            type: 'uuid',
          },
          {
            name: 'requester_id',
            type: 'uuid',
          },
          {
            name: 'owner_id',
            type: 'uuid',
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
          },
          {
            name: 'pickup_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'pickup_time',
            type: 'time',
            isNullable: true,
          },
          {
            name: 'confirmation_code',
            type: 'varchar',
            length: '10',
            isNullable: true,
          },
          {
            name: 'is_picked_up',
            type: 'boolean',
            default: false,
          },
          {
            name: 'picked_up_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'cancelled_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'cancelled_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'cancellation_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
    );

    // Create indexes for item_requests
    await queryRunner.createIndex(
      'item_requests',
      new TableIndex({
        name: 'IDX_ITEM_REQUESTS_ITEM',
        columnNames: ['item_id'],
      }),
    );

    await queryRunner.createIndex(
      'item_requests',
      new TableIndex({
        name: 'IDX_ITEM_REQUESTS_REQUESTER',
        columnNames: ['requester_id'],
      }),
    );

    await queryRunner.createIndex(
      'item_requests',
      new TableIndex({
        name: 'IDX_ITEM_REQUESTS_OWNER',
        columnNames: ['owner_id'],
      }),
    );

    await queryRunner.createIndex(
      'item_requests',
      new TableIndex({
        name: 'IDX_ITEM_REQUESTS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'item_requests',
      new TableIndex({
        name: 'IDX_ITEM_REQUESTS_CREATED',
        columnNames: ['created_at'],
      }),
    );

    // Create foreign keys for item_requests
    await queryRunner.createForeignKey(
      'item_requests',
      new TableForeignKey({
        columnNames: ['item_id'],
        referencedTableName: 'items',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'item_requests',
      new TableForeignKey({
        columnNames: ['requester_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'item_requests',
      new TableForeignKey({
        columnNames: ['owner_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'item_requests',
      new TableForeignKey({
        columnNames: ['cancelled_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Add CHECK constraint for status
    await queryRunner.query(`
      ALTER TABLE item_requests 
      ADD CONSTRAINT chk_item_requests_status 
      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'expired'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop item_requests table
    await queryRunner.dropTable('item_requests', true, true, true);

    // Drop item_views table
    await queryRunner.dropTable('item_views', true, true, true);

    // Drop saved_items table
    await queryRunner.dropTable('saved_items', true, true, true);
  }
}
