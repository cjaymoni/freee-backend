# Database Migrations

This directory contains TypeORM database migrations for the application.

## Migration Commands

### Generate a new migration

Automatically generates a migration by comparing your entities with the database schema:

```bash
npm run migration:generate src/migrations/MigrationName
```

### Create an empty migration

Creates an empty migration file for manual changes:

```bash
npm run migration:create src/migrations/MigrationName
```

### Run pending migrations

Executes all pending migrations:

```bash
npm run migration:run
```

### Revert last migration

Reverts the most recently executed migration:

```bash
npm run migration:revert
```

### Show migration status

Displays which migrations have been run:

```bash
npm run migration:show
```

### Drop entire schema (DANGEROUS)

Drops all tables in the database:

```bash
npm run schema:drop
```

### Sync schema (DEVELOPMENT ONLY)

Synchronizes the database schema with entities (not recommended for production):

```bash
npm run schema:sync
```

## Best Practices

1. **Never use `synchronize: true` in production** - Always use migrations
2. **Review generated migrations** - Always check auto-generated migrations before running
3. **Test migrations** - Test both `up` and `down` methods
4. **Version control** - Commit migrations to git
5. **Sequential naming** - Migrations are run in timestamp order
6. **Backup before running** - Always backup production databases before migrations

## Workflow Example

1. Make changes to your entity files
2. Generate migration:
   ```bash
   npm run migration:generate src/migrations/AddUserProfileFields
   ```
3. Review the generated migration file
4. Run the migration:
   ```bash
   npm run migration:run
   ```
5. If something goes wrong, revert:
   ```bash
   npm run migration:revert
   ```

## Migration File Structure

Each migration file contains two methods:

- `up()` - Applied when running the migration
- `down()` - Applied when reverting the migration

Example:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfileFields1234567890123 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add your schema changes here
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert your schema changes here
  }
}
```
