# Response Format Standardization

## Overview

All services in the application have been standardized to return responses wrapped in the `ServiceResponseDto` format. This ensures consistency across the API and makes client-side handling more predictable.

## ServiceResponseDto Structure

```typescript
{
  state: boolean,        // Success/failure indicator
  data: T,              // The actual response data
  message: string,      // Human-readable message
  statusCode: number,   // HTTP status code (200, 201, etc.)
  error?: string,       // Optional error message (for failures)
  errors?: any[]        // Optional validation errors (for failures)
}
```

## Updated Services

### 1. ItemService

**Location**: `src/item/item.service.ts`

All methods now return `ServiceResponseDto<ItemResponseDto>` or `ServiceResponseDto<ItemResponseDto[]>`:

- `create()` → 201 status code with "Item created successfully"
- `findAll()` → 200 status code with "Items retrieved successfully"
- `findOne()` → 200 status code with "Item retrieved successfully"
- `update()` → 200 status code with "Item updated successfully"
- `remove()` → 200 status code with "Item deleted successfully"
- `feature()` → 200 status code with "Item featured successfully"
- `unfeature()` → 200 status code with "Item unfeatured successfully"

### 2. CategoryService

**Location**: `src/category/category.service.ts`

All methods now return `ServiceResponseDto<CategoryResponseDto>` or `ServiceResponseDto<CategoryResponseDto[]>`:

- `create()` → 201 status code with "Category created successfully"
- `findAll()` → 200 status code with "Categories retrieved successfully"
- `findOne()` → 200 status code with "Category retrieved successfully"
- `findBySlug()` → 200 status code with "Category retrieved successfully"
- `update()` → 200 status code with "Category updated successfully"
- `remove()` → 200 status code with "Category deleted successfully"
- `toggleActive()` → 200 status code with "Category status toggled successfully"

### 3. ItemImageService

**Location**: `src/item/item-image.service.ts`

All methods now return `ServiceResponseDto<ItemImageResponseDto>` or `ServiceResponseDto<ItemImageResponseDto[]>`:

- `create()` → 201 status code with "Image added successfully"
- `findAllByItemId()` → 200 status code with "Images retrieved successfully"
- `findOne()` → 200 status code with "Image retrieved successfully"
- `setPrimary()` → 200 status code with "Image set as primary successfully"
- `updateDisplayOrder()` → 200 status code with "Display order updated successfully"
- `remove()` → 200 status code with "Image deleted successfully"

### 4. UserLocationService

**Location**: `src/user/user-location.service.ts`

All methods now return `ServiceResponseDto<UserLocationResponseDto>` or `ServiceResponseDto<UserLocationResponseDto[]>`:

- `create()` → 201 status code with "Location created successfully"
- `createTemporary()` → 201 status code with "Temporary location created successfully"
- `findAllForAdmin()` → 200 status code with "All locations retrieved successfully"
- `findAllByUserId()` → 200 status code with "User locations retrieved successfully"
- `findOne()` → 200 status code with "Location retrieved successfully"
- `update()` → 200 status code with "Location updated successfully"
- `setPrimary()` → 200 status code with "Location set as primary successfully"
- `setCurrent()` → 200 status code with "Location set as current successfully"
- `remove()` → 200 status code with "Location deleted successfully" (returns `ServiceResponseDto<null>`)
- `findByCountryCode()` → 200 status code with "Locations retrieved successfully"

**Note**: `findPrimaryLocation()` and `findCurrentLocation()` still return nullable DTOs directly as they are not exposed through controllers.

### 5. UserPreferenceService

**Location**: `src/user/user-preference.service.ts`

All methods now return `ServiceResponseDto<UserPreferenceResponseDto>`:

- `create()` → 201 status code with "User preferences created successfully"
- `findByUserId()` → 200 status code with "User preferences retrieved successfully"
- `getOrCreate()` → 200 status code with "User preferences retrieved successfully"
- `update()` → 200 status code with "User preferences updated successfully"
- `updateCategories()` → 200 status code with "Preferred categories updated successfully"
- `updateNotificationSettings()` → 200 status code with "Notification settings updated successfully"
- `updateLanguage()` → 200 status code with "Language preference updated successfully"
- `updateTheme()` → 200 status code with "Theme preference updated successfully"
- `remove()` → 200 status code with "User preferences deleted successfully" (returns `ServiceResponseDto<null>`)

### 6. UserService

**Location**: `src/user/user.service.ts`

Already implemented with `ServiceResponseDto` format (served as the reference standard):

- `create()` → 201 status code
- `findAll()` → 200 status code
- `findOne()` → 200 status code
- `update()` → 200 status code
- `remove()` → 200 status code

## Controller Updates

All corresponding controllers have been updated to reflect the new return types:

- `ItemController` (`src/item/item.controller.ts`)
- `CategoryController` (`src/category/category.controller.ts`)
- `ItemImageController` (`src/item/item-image.controller.ts`)
- `UserLocationController` (`src/user/user-location.controller.ts`)
- `UserPreferenceController` (`src/user/user-preference.controller.ts`)

## Benefits

1. **Consistency**: All API responses follow the same structure
2. **Predictability**: Clients can expect the same response format from all endpoints
3. **Error Handling**: Unified error response structure
4. **Type Safety**: TypeScript ensures proper type checking
5. **Metadata**: Additional metadata (statusCode, message) available for all responses

## Usage Examples

### Successful Response

```typescript
{
  state: true,
  data: {
    id: "123",
    title: "Example Item",
    // ... other fields
  },
  message: "Item retrieved successfully",
  statusCode: 200
}
```

### Array Response

```typescript
{
  state: true,
  data: [
    { id: "1", name: "Category 1" },
    { id: "2", name: "Category 2" }
  ],
  message: "Categories retrieved successfully",
  statusCode: 200
}
```

### Delete Response

```typescript
{
  state: true,
  data: null,
  message: "Location deleted successfully",
  statusCode: 200
}
```

## Migration Notes

- All service methods that previously returned DTOs directly now wrap them in `ServiceResponseDto`
- Controllers return `ServiceResponseDto<T>` instead of `T` directly
- The HTTP status code is included in the response body for client convenience
- Void return types have been changed to `ServiceResponseDto<null>` for consistency

## Build Status

✅ All changes compiled successfully with no TypeScript errors
✅ Response format is now consistent across all services
✅ API documentation (Swagger) updated automatically

## Date Completed

January 2025
