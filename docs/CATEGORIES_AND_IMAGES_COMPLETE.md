# Categories & Item Images - Complete Implementation

## Overview

Implemented two essential modules for the marketplace:

1. **Categories** - Hierarchical category system with parent/child relationships
2. **Item Images** - Multi-image support for items with Cloudinary integration

## Categories Module

### CategoryEntity

- **Table**: `categories`
- **Key Features**:
  - Hierarchical structure (parent-child relationships)
  - URL-friendly slugs (unique, validated format)
  - Optional icon URLs
  - Display ordering
  - Active/inactive status
  - Soft delete support

### Relations

- **Self-referential**: `parent_category_id` → `categories.id`
- **Items**: OneToMany to ItemEntity

### Indexes

- `slug` (for quick lookups)
- `parent_category_id` (for hierarchical queries)
- `is_active, is_deleted` (for filtering)

### API Endpoints

#### Public Endpoints

```
GET    /categories                    - List all categories (with filters)
GET    /categories/slug/:slug         - Get category by slug
GET    /categories/:id                - Get category by ID
```

#### Admin Endpoints (Requires ADMIN role)

```
POST   /categories                    - Create new category
PUT    /categories/:id                - Update category
DELETE /categories/:id                - Soft delete category
POST   /categories/:id/toggle-active  - Toggle active status
```

### Query Parameters (GET /categories)

- `active_only` (boolean, default: true) - Filter only active categories
- `include_subcategories` (boolean, default: true) - Include nested subcategories

### Business Logic

#### Slug Validation

- Must be lowercase with hyphens only
- Format: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- Example: `"electronics-phones"`, `"furniture"`
- Unique constraint enforced

#### Parent-Child Relationships

- Categories can have subcategories
- Prevents circular references (category can't be its own parent)
- Cannot delete category with active subcategories

#### Display Order

- Nullable integer field for custom sorting
- Primary sort: `display_order ASC NULLS LAST`
- Secondary sort: `name ASC`

### DTOs

#### CreateCategoryDto

```typescript
{
  name: string;              // max 100 chars
  slug: string;              // unique, validated format
  icon_url?: string;         // optional URL
  parent_category_id?: uuid; // optional parent
  display_order?: number;    // optional sort order
  is_active?: boolean;       // default: true
}
```

#### CategoryResponseDto

- Includes `subcategories` array when loaded
- Includes `item_count` when items relation is loaded

### Example Usage

**Create Top-Level Category:**

```json
POST /categories
{
  "name": "Electronics",
  "slug": "electronics",
  "icon_url": "https://example.com/icons/electronics.png",
  "display_order": 1,
  "is_active": true
}
```

**Create Subcategory:**

```json
POST /categories
{
  "name": "Smartphones",
  "slug": "smartphones",
  "parent_category_id": "electronics-category-uuid",
  "display_order": 1
}
```

---

## Item Images Module

### ItemImageEntity

- **Table**: `item_images`
- **Key Features**:
  - Multiple images per item
  - Cloudinary integration
  - Primary image designation
  - Display ordering
  - Soft delete support

### Relations

- **Item**: ManyToOne to ItemEntity (CASCADE on delete)

### Indexes

- `item_id` (for querying item images)
- `display_order` (for sorting)
- `cloudinary_public_id` (unique, for preventing duplicates)
- `item_id, is_deleted` (composite for efficient filtering)

### API Endpoints

All endpoints require JWT authentication. Users can only modify images for their own items.

```
POST   /items/:itemId/images                        - Add image to item
GET    /items/:itemId/images                        - Get all item images
GET    /items/:itemId/images/:imageId               - Get specific image
PATCH  /items/:itemId/images/:imageId/set-primary   - Set as primary image
PATCH  /items/:itemId/images/:imageId/display-order - Update display order
DELETE /items/:itemId/images/:imageId               - Delete image
```

### Business Logic

#### Primary Image Management

- Each item can have one primary image
- When setting a new primary, previous primary is automatically unset
- First image uploaded is automatically set as primary
- When primary image is deleted, next image becomes primary

#### Image Requirements

- Items must have at least one image
- Cannot delete the last image
- Soft deletes preserve Cloudinary data for cleanup

#### Display Order

- Default: 0
- Sorting: `is_primary DESC, display_order ASC, created_at ASC`
- Primary image always displayed first

#### Ownership Validation

- Users can only add/modify/delete images for their own items
- Throws `ForbiddenException` for unauthorized access

### DTOs

#### CreateItemImageDto

```typescript
{
  cloudinary_public_id: string;    // Required
  cloudinary_url: string;          // Required
  cloudinary_secure_url: string;   // Required
  cloudinary_format?: string;      // e.g., "jpg", "png"
  width?: number;                  // pixels
  height?: number;                 // pixels
  size_bytes?: number;             // file size
  display_order?: number;          // default: 0
  is_primary?: boolean;            // default: false
}
```

#### ItemImageResponseDto

- All entity fields except `is_deleted` and `deleted_at`
- Includes metadata for frontend display

### Example Usage

**Upload First Image (Auto-Primary):**

```json
POST /items/item-uuid/images
{
  "cloudinary_public_id": "items/abc123",
  "cloudinary_url": "http://res.cloudinary.com/demo/image/upload/v1/items/abc123.jpg",
  "cloudinary_secure_url": "https://res.cloudinary.com/demo/image/upload/v1/items/abc123.jpg",
  "cloudinary_format": "jpg",
  "width": 1200,
  "height": 800,
  "size_bytes": 245678
}
```

**Add Additional Image:**

```json
POST /items/item-uuid/images
{
  "cloudinary_public_id": "items/def456",
  "cloudinary_url": "...",
  "cloudinary_secure_url": "...",
  "display_order": 1
}
```

**Set as Primary:**

```
PATCH /items/item-uuid/images/image-uuid/set-primary
```

**Update Display Order:**

```json
PATCH /items/item-uuid/images/image-uuid/display-order
{
  "display_order": 2
}
```

---

## ItemEntity Updates

### New Relations Added

```typescript
@ManyToOne(() => CategoryEntity, (category) => category.items)
@JoinColumn({ name: 'category_id' })
category: CategoryEntity;

@OneToMany(() => ItemImageEntity, (image) => image.item)
images: ItemImageEntity[];
```

### ItemResponseDto Enhancements

Now includes:

- `category` (CategoryResponseDto) - Full category details when loaded
- `images` (ItemImageResponseDto[]) - All non-deleted images, sorted by primary/order

### ItemService Updates

- **findAll()**: Now loads category and images relations
- **findOne()**: Includes category and images with automatic filtering of deleted images

---

## Migration

### Generated Migration: 1767860392658-CreateCategoriesAndItemImages.ts

Creates:

- **categories table** with self-referential foreign key
- **item_images table** with foreign key to items
- **Updates items table** with foreign key to categories
- All required indexes and constraints

**Run Migration:**

```bash
npm run migration:run
```

---

## Integration Examples

### Creating an Item with Category and Images

**Step 1: Create Category (Admin)**

```bash
POST /categories
{
  "name": "Furniture",
  "slug": "furniture",
  "display_order": 1
}
# Returns: { id: "category-uuid", ... }
```

**Step 2: Create Item with Category**

```bash
POST /items
{
  "title": "Vintage Sofa",
  "description": "Comfortable 3-seater",
  "condition": "good",
  "category_id": "category-uuid",
  "location_id": "location-uuid",
  "is_free": true
}
# Returns: { id: "item-uuid", ... }
```

**Step 3: Upload Images**

```bash
# Upload from Cloudinary first, then:
POST /items/item-uuid/images
{
  "cloudinary_public_id": "sofa_1",
  "cloudinary_url": "...",
  "cloudinary_secure_url": "..."
}

POST /items/item-uuid/images
{
  "cloudinary_public_id": "sofa_2",
  "cloudinary_url": "...",
  "cloudinary_secure_url": "...",
  "display_order": 1
}
```

**Step 4: Fetch Complete Item**

```bash
GET /items/item-uuid

Response:
{
  "id": "item-uuid",
  "title": "Vintage Sofa",
  "category": {
    "id": "category-uuid",
    "name": "Furniture",
    "slug": "furniture"
  },
  "images": [
    {
      "id": "image-1-uuid",
      "cloudinary_secure_url": "...",
      "is_primary": true,
      "display_order": 0
    },
    {
      "id": "image-2-uuid",
      "cloudinary_secure_url": "...",
      "is_primary": false,
      "display_order": 1
    }
  ],
  "location": { ... },
  ...
}
```

---

## Security

### Categories

- Public read access (GET endpoints)
- Admin-only write access (POST, PUT, DELETE)
- RolesGuard enforces ADMIN role for mutations

### Item Images

- All endpoints require JWT authentication
- Ownership validation on all mutations
- Users can only modify images for their own items
- Prevents deletion of last image

---

## Files Created

```
src/category/
├── entities/
│   └── category.entity.ts
├── dto/
│   ├── create-category.dto.ts
│   ├── update-category.dto.ts
│   └── category-response.dto.ts
├── category.service.ts
├── category.controller.ts
└── category.module.ts

src/item/
├── entities/
│   └── item-image.entity.ts
├── dto/
│   ├── create-item-image.dto.ts
│   └── item-image-response.dto.ts
├── item-image.service.ts
└── item-image.controller.ts

src/migrations/
└── 1767860392658-CreateCategoriesAndItemImages.ts
```

---

## Next Steps

1. **Run Migration**: `npm run migration:run`
2. **Seed Categories**: Create initial category structure (admin)
3. **Test Image Upload**: Integrate with Cloudinary upload flow
4. **Frontend Integration**:
   - Category selector in item creation form
   - Multi-image upload component
   - Image reordering UI
   - Primary image indicator

## Future Enhancements

### Categories

- [ ] Category icons upload to Cloudinary
- [ ] Category-based search filters
- [ ] Popular categories analytics
- [ ] Category merge/rename tools

### Item Images

- [ ] Image cropping/resizing on upload
- [ ] Thumbnail generation
- [ ] Bulk image operations
- [ ] Image optimization metrics
- [ ] Automatic Cloudinary cleanup for deleted images
