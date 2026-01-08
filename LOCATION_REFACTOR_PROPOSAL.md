# Location Architecture Proposal

## Problem

Current design duplicates location data:

- Users have `user_locations` table
- Items have `latitude, longitude, pickup_location` fields directly

This leads to:

- ❌ Data duplication when users list items from home
- ❌ Poor UX: users re-enter locations for each item
- ❌ Inconsistent location data
- ❌ No location reusability

## Recommended Solution: Shared Locations Table

### New Schema

```typescript
// Rename: user_locations → locations (central table)
@Entity('locations')
export class LocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Owner of this location (nullable for public/system locations)
  @Column({ type: 'uuid', nullable: true })
  @Index()
  user_id: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  // Location details
  @Column({ type: 'varchar', length: 3, nullable: false })
  country_code: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  country_name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  area: string;

  @Column({ type: 'text', nullable: true })
  address: string; // Full address text

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  @Index()
  latitude: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  @Index()
  longitude: number;

  // User-specific flags (only apply when user_id is set)
  @Column({ type: 'boolean', default: false })
  is_current: boolean;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  // Naming for saved locations
  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string; // e.g., "Home", "Office", "Warehouse"

  // Soft delete
  @Column({ type: 'boolean', default: false })
  @Index()
  is_deleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deleted_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @OneToMany(() => ItemEntity, (item) => item.location)
  items: ItemEntity[];
}
```

### Updated Items Table

```typescript
@Entity('items')
export class ItemEntity {
  // ... existing fields ...

  // INSTEAD OF: latitude, longitude, pickup_location
  // USE: location_id reference
  @Column({ type: 'uuid', nullable: false })
  @Index()
  location_id: string;

  @ManyToOne(() => LocationEntity, { nullable: false })
  @JoinColumn({ name: 'location_id' })
  location: LocationEntity;

  // Optional: Keep pickup_date
  @Column({ type: 'date', nullable: true })
  pickup_date: Date;

  // ... rest of fields ...
}
```

### Migration Strategy

**Phase 1: Add new table**

```sql
-- Create locations table
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  country_code VARCHAR(3) NOT NULL,
  country_name VARCHAR(100) NOT NULL,
  region VARCHAR(100),
  city VARCHAR(100),
  area VARCHAR(100),
  address TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  is_current BOOLEAN DEFAULT false,
  is_primary BOOLEAN DEFAULT false,
  label VARCHAR(100),
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migrate data from user_locations
INSERT INTO locations (
  id, user_id, country_code, country_name, region, city, area,
  latitude, longitude, is_current, is_primary, is_deleted, deleted_at,
  created_at, updated_at
)
SELECT
  id, user_id, country_code, country_name, region, city, area,
  latitude, longitude, is_current, is_primary, is_deleted, deleted_at,
  created_at, updated_at
FROM user_locations;
```

**Phase 2: Add location_id to items**

```sql
-- Add location_id column
ALTER TABLE items ADD COLUMN location_id UUID REFERENCES locations(id);

-- Migrate existing items: create location entries from lat/long
INSERT INTO locations (user_id, address, latitude, longitude, label)
SELECT
  user_id,
  pickup_location,
  latitude,
  longitude,
  'Item Pickup Location'
FROM items
WHERE latitude IS NOT NULL OR longitude IS NOT NULL;

-- Update items with new location_id
UPDATE items i
SET location_id = l.id
FROM locations l
WHERE l.user_id = i.user_id
  AND l.latitude = i.latitude
  AND l.longitude = i.longitude;

-- Remove old columns
ALTER TABLE items
  DROP COLUMN latitude,
  DROP COLUMN longitude,
  DROP COLUMN pickup_location;
```

## Benefits ✅

### 1. **Reusable Saved Locations**

```typescript
// User creates item, selects from saved locations
POST /items
{
  "title": "Free Sofa",
  "location_id": "user-home-location-id", // ← Reuse saved location
  "category_id": "...",
  ...
}
```

### 2. **Better UX Flow**

```typescript
// Step 1: User saves common locations
POST /user/locations
{ "label": "Home", "address": "123 Main St", ... }

// Step 2: When listing items, just reference it
// No need to re-enter location details!
```

### 3. **Consistent Location Data**

- Users update location once, all items reflect change
- Easier to fix address mistakes
- Better for search/filtering

### 4. **Advanced Features Unlocked**

- 📍 "Show all my items at this location"
- 🗺️ Location-based item clustering on maps
- 🔍 Better search: "Items near [user's saved location]"
- 📊 Analytics: "Which locations have most items"

### 5. **Flexible Item Posting**

```typescript
// Option A: Use saved location
{ "location_id": "uuid-of-saved-location" }

// Option B: Create one-time location (for occasional spots)
POST /locations/temporary
{ "latitude": 40.7128, "longitude": -74.0060, "address": "Central Park" }
→ returns location_id to use in item
```

## API Changes

### New Endpoints

```typescript
// Existing user location endpoints work the same
GET    /user/locations          // List saved locations
POST   /user/locations          // Save new location
PUT    /user/locations/:id      // Update location
DELETE /user/locations/:id      // Delete location

// New: Create temporary/one-time location for items
POST   /locations/temporary     // Create location (not saved to user profile)
GET    /locations/:id            // Get location details
```

### Updated Item Endpoints

```typescript
POST /items
{
  "title": "Free Desk",
  "location_id": "uuid",  // ← Now required
  "pickup_date": "2026-01-15",
  ...
}

GET /items/:id
{
  "id": "...",
  "title": "Free Desk",
  "location": {  // ← Populated location object
    "id": "...",
    "address": "123 Main St",
    "city": "San Francisco",
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  ...
}
```

## Recommendation

**✅ YES - Refactor to central locations table**

This is the right move for a marketplace app because:

1. **User benefit**: Save locations once, reuse for all items
2. **Data quality**: Consistent, updatable location data
3. **Features**: Enables location-based features and analytics
4. **Scale**: Reduces data duplication as items grow

The migration is straightforward and can be done without downtime.

## Next Steps

If you want to proceed:

1. I'll create the new `LocationEntity` (rename from `UserLocationEntity`)
2. Update `ItemEntity` to reference locations
3. Create migration scripts
4. Add temporary location endpoints
5. Update existing services/controllers
6. Write migration guide

Let me know if you want me to implement this! 🚀
