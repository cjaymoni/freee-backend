# Item Module - Complete Implementation

## Overview

The Item module manages marketplace listings with location integration, allowing users to create, update, and browse items. Admin users can feature items for increased visibility.

## Key Changes from Original Schema

- **Location Integration**: Replaced individual `latitude`, `longitude`, and `pickup_location` fields with a single `location_id` field that references the centralized `locations` table
- **Benefits**: Users can select from saved locations, create temporary locations, and items automatically get full address details

## Entity Structure

### ItemEntity

- **Table**: `items`
- **Primary Key**: `id` (UUID)
- **Key Relations**:
  - `user` → `UserEntity` (CASCADE on delete)
  - `location` → `LocationEntity` (SET NULL on delete)
  - `deletedByUser` → `UserEntity` (SET NULL on delete)

### Enums

- **ItemCondition**: `new`, `like_new`, `good`, `fair`, `poor`
- **ItemStatus**: `available`, `reserved`, `picked_up`, `unavailable`

### Key Fields

- `title` (required, max 255 chars)
- `description` (optional)
- `category_id` (optional, prepared for future CategoryEntity)
- `condition` (required, enum)
- `status` (default: available)
- `price` (decimal 10,2, default: 0)
- `is_free` (default: true)
- `location_id` (references locations table)
- `pickup_date` (optional)
- `is_featured` / `featured_until` (admin-managed)
- Soft delete fields: `is_deleted`, `deleted_at`, `deleted_by`, `deletion_reason`

### Indexes

- User ID, category ID, status, created_at
- Location ID for location-based queries
- Composite indexes for filtering: status+deleted+created, category+status+deleted+created, featured+status+deleted+featured_until
- Soft delete index: is_deleted+deleted_at

## API Endpoints

### User Endpoints

```
POST   /items                  - Create new item (requires auth)
GET    /items                  - List all items with filters (requires auth)
GET    /items/my-items         - Get authenticated user's items
GET    /items/:id              - Get item by ID (increments view count)
PUT    /items/:id              - Update item (owner only)
DELETE /items/:id?reason=...   - Soft delete item (owner only)
```

### Admin Endpoints

```
POST   /items/:id/feature?featured_until=...  - Feature an item (ADMIN)
DELETE /items/:id/feature                     - Remove featured status (ADMIN)
```

### Query Filters (GET /items)

- `user_id` - Filter by user
- `category_id` - Filter by category
- `status` - Filter by status (available, reserved, etc.)
- `is_featured` - Filter featured items
- `is_free` - Filter free items

## DTOs

### CreateItemDto

Required:

- `title` (string, max 255)
- `condition` (enum: ItemCondition)

Optional:

- `description` (text)
- `category_id` (UUID)
- `price` (number, min 0)
- `is_free` (boolean, default true)
- `location_id` (UUID - reference to saved or temporary location)
- `pickup_date` (date)

### UpdateItemDto

Extends CreateItemDto with optional `status` field for updating item status.

### ItemResponseDto

Includes all entity fields plus nested `location` object (UserLocationResponseDto) when loaded.

## Business Logic

### Price Validation

- If `is_free` is true and `price > 0`, throws BadRequestException
- When marked as free, price is automatically set to 0

### Ownership Checks

- Users can only update/delete their own items
- Throws ForbiddenException for unauthorized modifications

### View Count

- Automatically increments when item is viewed via GET /items/:id

### Soft Delete

- Sets `is_deleted`, `deleted_at`, `deleted_by`, `deletion_reason`
- Automatically sets status to UNAVAILABLE
- Preserves data for audit/history

### Featured Items (Admin)

- `feature()` - Sets `is_featured` to true, optionally with expiration date
- `unfeature()` - Removes featured status

## Migration

### Generated Migration: 1767859975942-CreateItemsTable.ts

Creates:

- Enums: `items_condition_enum`, `items_status_enum`
- Table: `items` with all columns
- Indexes: As defined in entity
- Foreign keys: user_id → users(id), location_id → locations(id), deleted_by → users(id)

**Run Migration**:

```bash
npm run migration:run
```

## Integration with Locations

Items now use the centralized locations system:

1. **Using Saved Location**:

   ```json
   {
     "title": "Vintage Lamp",
     "condition": "good",
     "location_id": "uuid-of-saved-location"
   }
   ```

2. **Creating Temporary Location First**:

   ```bash
   # Create temporary location
   POST /user/locations/temporary
   {
     "latitude": 40.7589,
     "longitude": -73.9851,
     "label": "Central Park Entrance",
     "address": "59th St & 5th Ave, New York"
   }

   # Use returned location_id when creating item
   POST /items
   {
     "title": "Bicycle",
     "condition": "like_new",
     "location_id": "returned-uuid"
   }
   ```

## Response Example

```json
{
  "id": "item-uuid",
  "user_id": "user-uuid",
  "title": "Vintage Camera",
  "description": "Working 35mm film camera",
  "category_id": null,
  "condition": "good",
  "status": "available",
  "price": 0,
  "is_free": true,
  "view_count": 5,
  "location_id": "location-uuid",
  "location": {
    "id": "location-uuid",
    "latitude": 40.7589,
    "longitude": -73.9851,
    "label": "Brooklyn Workshop",
    "address": "123 Main St, Brooklyn, NY",
    "is_primary": false,
    "is_current": false
  },
  "pickup_date": "2026-01-15",
  "is_featured": false,
  "featured_until": null,
  "created_at": "2026-01-08T00:00:00.000Z",
  "updated_at": "2026-01-08T00:00:00.000Z"
}
```

## Security

- All endpoints require JWT authentication
- Feature/unfeature endpoints require ADMIN role
- Users can only modify their own items
- Soft deletes preserve audit trail

## Future Enhancements

Ready for integration with:

- **CategoryEntity** - Uncomment relation in ItemEntity
- **ItemImageEntity** - Multiple images per item
- **ItemReportEntity** - User reports for inappropriate items
- **Search/Filtering** - Geographic radius search using location coordinates
- **Favorites/Saved Items** - User saved items functionality

## Files Created

```
src/item/
├── entities/
│   └── item.entity.ts
├── dto/
│   ├── create-item.dto.ts
│   ├── update-item.dto.ts
│   └── item-response.dto.ts
├── item.service.ts
├── item.controller.ts
└── item.module.ts

src/migrations/
└── 1767859975942-CreateItemsTable.ts
```

## Next Steps

1. Run migration: `npm run migration:run`
2. Test item creation with location_id
3. Verify location details are loaded in item responses
4. Test admin feature/unfeature endpoints
5. Consider implementing Categories module
6. Add image upload functionality
