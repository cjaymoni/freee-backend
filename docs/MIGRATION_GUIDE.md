# Database Migration Setup - Quick Reference

## 🚀 Quick Start

### Generate Migration from Entity Changes

```bash
npm run migration:generate /InitialSchema
```

### Run Migrations

```bash
npm run migration:run
```

### Revert Last Migration

```bash
npm run migration:revert
```

---

## 📋 All Available Commands

| Command              | Description                                 | Usage                                       |
| -------------------- | ------------------------------------------- | ------------------------------------------- |
| `migration:generate` | Auto-generate migration from entity changes | `npm run migration:generate /AddUserFields` |
| `migration:create`   | Create empty migration file                 | `npm run migration:create /CustomChanges`   |
| `migration:run`      | Execute all pending migrations              | `npm run migration:run`                     |
| `migration:revert`   | Undo the last executed migration            | `npm run migration:revert`                  |
| `migration:show`     | Show migration status                       | `npm run migration:show`                    |
| `schema:drop`        | ⚠️ Drop entire database schema              | `npm run schema:drop`                       |
| `schema:sync`        | ⚠️ Sync schema (dev only)                   | `npm run schema:sync`                       |

---

## 🔧 Configuration Files

### `src/config/data-source.ts`

TypeORM CLI configuration for migrations

- Used by migration commands
- Loads environment variables from `.env`

### `src/config/typeorm.config.ts`

NestJS TypeORM module configuration

- Used by the application at runtime
- Auto-runs migrations in production
- Disables `synchronize` in production

---

## 📝 Common Workflows

### 1. Adding New Fields to Entity

```bash
# 1. Update your entity file (e.g., user.entity.ts)
# 2. Generate migration
npm run migration:generate /AddUserProfileFields

# 3. Review the generated file in src/migrations/
# 4. Run the migration
npm run migration:run
```

### 2. Creating Custom Migration

```bash
# 1. Create empty migration
npm run migration:create /AddCustomIndexes

# 2. Edit the file and add your SQL
# 3. Run the migration
npm run migration:run
```

### 3. Rolling Back Changes

```bash
# Revert last migration
npm run migration:revert

# Check status
npm run migration:show
```

---

## ⚠️ Important Notes

### Production Safety

- ✅ `synchronize` is **disabled** in production
- ✅ Migrations **auto-run** on production startup
- ✅ Always test migrations in development first

### Environment Variables Required

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=freee
NODE_ENV=development
```

### Migration File Location

- **Source**: `src/migrations/*.ts`
- **Compiled**: `dist/migrations/*.js` (used in production)

### Migration Naming

- Add `/` before the name: `/InitialSchema`
- TypeORM adds timestamp: `1765453073388-InitialSchema.ts`
- Use descriptive names: `/AddUserEmail`, `/CreatePostsTable`

---

## 🐛 Troubleshooting

### "No migrations found"

- Check `src/migrations/` directory exists
- Verify files have `.ts` extension
- Ensure `src/config/data-source.ts` points to correct path

### "Migration has already been run"

- Check status: `npm run migration:show`
- Tracked in `migrations` table in database

### "Cannot find module 'dotenv'"

- Already included in dependencies
- Run `npm install` if needed

### Connection Issues

- Verify `.env` file exists with correct credentials
- Check database is running
- Test connection manually

---

## 📚 Files Created

1. **`src/config/data-source.ts`** - TypeORM CLI configuration
2. **`src/migrations/`** - Migration files directory
3. **`src/migrations/README.md`** - Detailed documentation
4. **Updated `package.json`** - Added migration scripts
5. **Updated `typeorm.config.ts`** - Production-safe configuration
