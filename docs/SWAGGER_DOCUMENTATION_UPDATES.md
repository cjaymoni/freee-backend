# Swagger Documentation Updates

## Overview

Updated all Swagger/OpenAPI documentation to reflect the standardized `ServiceResponseDto` wrapper format across all API endpoints.

## Date

December 2024

## Changes Made

### 1. ItemController (8 endpoints)

Updated all `@ApiResponse` decorators to document the wrapped response structure:

- ✅ `create` - POST /items
- ✅ `findAll` - GET /items
- ✅ `findMyItems` - GET /items/my-items
- ✅ `findOne` - GET /items/:id
- ✅ `update` - PATCH /items/:id
- ✅ `remove` - DELETE /items/:id
- ✅ `feature` - PATCH /items/:id/feature
- ✅ `unfeature` - PATCH /items/:id/unfeature

### 2. CategoryController (7 endpoints)

Updated all `@ApiResponse` decorators to document the wrapped response structure:

- ✅ `create` - POST /categories
- ✅ `findAll` - GET /categories
- ✅ `findBySlug` - GET /categories/slug/:slug
- ✅ `findOne` - GET /categories/:id
- ✅ `update` - PATCH /categories/:id
- ✅ `remove` - DELETE /categories/:id
- ✅ `toggleActive` - PATCH /categories/:id/toggle-active

### 3. ItemImageController (6 endpoints)

Updated all `@ApiResponse` decorators to document the wrapped response structure:

- ✅ `create` - POST /item-images
- ✅ `findAll` - GET /item-images
- ✅ `findOne` - GET /item-images/:id
- ✅ `setPrimary` - PATCH /item-images/:id/set-primary
- ✅ `updateDisplayOrder` - PATCH /item-images/:id/display-order
- ✅ `remove` - DELETE /item-images/:id

### 4. UserLocationController (10 endpoints)

Updated all `@ApiResponse` decorators to document the wrapped response structure:

- ✅ `create` - POST /user-locations
- ✅ `createTemporary` - POST /user-locations/temporary
- ✅ `findAllAdmin` - GET /user-locations/admin
- ✅ `findAll` - GET /user-locations
- ✅ `findByCountryCode` - GET /user-locations/country/:code
- ✅ `findOne` - GET /user-locations/:id
- ✅ `update` - PATCH /user-locations/:id
- ✅ `setPrimary` - PATCH /user-locations/:id/set-primary
- ✅ `setCurrent` - PATCH /user-locations/:id/set-current
- ✅ `remove` - DELETE /user-locations/:id

### 5. UserPreferenceController (9 endpoints)

Updated all `@ApiResponse` decorators to document the wrapped response structure:

- ✅ `create` - POST /user-preferences
- ✅ `findOne` - GET /user-preferences
- ✅ `getOrCreate` - GET /user-preferences/or-create
- ✅ `update` - PATCH /user-preferences
- ✅ `updateCategories` - PATCH /user-preferences/categories
- ✅ `updateNotificationSettings` - PATCH /user-preferences/notifications
- ✅ `updateLanguage` - PATCH /user-preferences/language
- ✅ `updateTheme` - PATCH /user-preferences/theme
- ✅ `remove` - DELETE /user-preferences

## Documentation Pattern

All endpoints now use the following standardized Swagger response schema:

```typescript
@ApiResponse({
  status: 200, // or 201, 204, etc.
  description: '[Action] successfully. Returns wrapped response with state, data ([Type]ResponseDto), message, and statusCode.',
  schema: {
    allOf: [
      {
        properties: {
          state: { type: 'boolean', example: true },
          message: { type: 'string', example: '[Success message]' },
          statusCode: { type: 'number', example: 200 },
          data: { $ref: '#/components/schemas/[Type]ResponseDto' },
        },
      },
    ],
  },
})
```

### Special Cases

#### DELETE Operations

For DELETE endpoints that return null data:

```typescript
data: { type: 'null', example: null }
```

#### Array Responses

For endpoints returning arrays:

```typescript
data: {
  type: 'array',
  items: { $ref: '#/components/schemas/[Type]ResponseDto' }
}
```

## Response Structure

All API responses now follow this consistent structure:

```json
{
  "state": true,
  "message": "Operation completed successfully",
  "statusCode": 200,
  "data": {
    // Response DTO data here
  }
}
```

For error responses:

```json
{
  "state": false,
  "message": "Error message",
  "statusCode": 400,
  "error": "Error details",
  "errors": ["Validation error 1", "Validation error 2"]
}
```

## Benefits

1. **Consistent API Documentation**: All endpoints now clearly show the wrapper structure
2. **Better Developer Experience**: Frontend developers can immediately see the response format
3. **Self-Documenting API**: Swagger UI displays accurate response examples
4. **OpenAPI Compliance**: Response schemas properly reference DTOs using `$ref`
5. **Type Safety**: Clear schema definitions help with code generation tools

## Verification

Build verification: ✅ PASSED

- No TypeScript errors
- All Swagger decorators properly structured
- Response schemas valid

## Related Documentation

- [Response Format Standardization](./RESPONSE_FORMAT_STANDARDIZATION.md) - Details on the ServiceResponseDto implementation
- [API Documentation](../README.md#api-documentation) - General API usage information

## Next Steps

To view the updated Swagger documentation:

1. Start the application: `npm run start:dev`
2. Navigate to: `http://localhost:3000/api`
3. Verify that all endpoints show the wrapped response structure

## Total Coverage

- **Controllers Updated**: 5
- **Endpoints Documented**: 40
- **Response Format**: Standardized ServiceResponseDto wrapper
- **Build Status**: ✅ Passing
