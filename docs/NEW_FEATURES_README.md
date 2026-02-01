# New Features Implementation

This document outlines the three new features that have been implemented:

## 1. Saved Items (Bookmarks)

**Location:** `src/saved-item/`

**Description:** Allows users to save/bookmark items for later viewing.

**Key Features:**

- Save/unsave items
- View saved items with pagination
- Check if an item is saved
- Soft delete support (restore previously saved items)

**API Endpoints:**

- `POST /saved-items` - Save an item
- `DELETE /saved-items/:itemId` - Unsave an item
- `GET /saved-items` - Get all saved items (paginated)
- `GET /saved-items/check/:itemId` - Check if item is saved

## 2. Item Views (Analytics)

**Location:** `src/item-view/`

**Description:** Tracks item views for analytics purposes. Includes anonymous and authenticated views.

**Key Features:**

- Record item views (authenticated or anonymous)
- Track device type, referrer, view duration, and IP address
- Get view statistics (total views, unique viewers, anonymous views, etc.)
- View history for authenticated users
- **Automated hourly cron job** to aggregate view counts

**API Endpoints:**

- `POST /item-views` - Record a view (no auth required)
- `GET /item-views/stats/:itemId` - Get item view statistics
- `GET /item-views/history` - Get user's viewing history (authenticated)

**Background Job:**

- Hourly cron job updates `items.view_count` from aggregated `item_views` data

## 3. Item Requests (Pickup Requests)

**Location:** `src/item-request/`

**Description:** Manages the request/pickup workflow for items.

**Key Features:**

- Create pickup requests with preferred date/time
- Owner can confirm requests with a confirmation code
- Cancel requests with reason (by requester or owner)
- Confirm pickup using confirmation code
- Track request status (pending, confirmed, cancelled, completed, expired)
- View sent and received requests

**API Endpoints:**

- `POST /item-requests` - Create a request
- `PATCH /item-requests/:requestId/confirm` - Confirm request (owner)
- `PATCH /item-requests/:requestId/cancel` - Cancel request
- `PATCH /item-requests/:requestId/pickup` - Confirm pickup (requester)
- `GET /item-requests/my-requests` - Get sent requests
- `GET /item-requests/received` - Get received requests
- `GET /item-requests/:requestId` - Get request details

**Workflow:**

1. Requester creates a request for an item
2. Owner receives notification and confirms with pickup details
3. System generates a confirmation code
4. Item status changes to "reserved"
5. At pickup, requester enters confirmation code
6. Item status changes to "picked_up"
7. Request marked as completed

## Installation & Setup

### 1. Install Required Dependencies

```bash
npm install @nestjs/schedule
```

### 2. Run Database Migration

```bash
npm run migration:run
```

This will create three new tables:

- `saved_items`
- `item_views`
- `item_requests`

### 3. Verify Module Registration

The following modules have been registered in `app.module.ts`:

- `SavedItemModule`
- `ItemViewModule`
- `ItemRequestModule`
- `ScheduleModule` (for cron jobs)

## Database Schema

### saved_items

- Stores user bookmarks/saved items
- Includes soft delete support
- Unique constraint on (user_id, item_id, is_deleted)

### item_views

- Tracks all item views for analytics
- Supports both authenticated and anonymous views
- Includes device type, referrer, duration tracking
- Optimized indexes for time-based queries

### item_requests

- Manages item pickup requests
- Tracks full request lifecycle with status changes
- Includes confirmation codes for secure pickup
- Stores cancellation reasons and metadata

## Testing

After installation, you can test the endpoints using:

- Swagger UI at `/api-docs`
- Postman/Thunder Client
- curl commands

## Notes

1. **Authentication:** Most endpoints require JWT authentication except:
   - `POST /item-views` (can be called anonymously)
   - `GET /item-views/stats/:itemId` (public stats)

2. **Cron Job:** The item views cron job runs every hour. Monitor logs for execution:

   ```
   [ItemViewService] Starting hourly view count update...
   [ItemViewService] Updated view counts for X items
   ```

3. **Item Status Changes:**
   - When a request is confirmed: item status → `reserved`
   - When pickup is confirmed: item status → `picked_up`
   - When request is cancelled: item status → `available`

4. **Soft Deletes:** Saved items use soft deletes, allowing users to "re-save" previously unsaved items.

## Future Enhancements

Possible improvements for consideration:

- Push notifications for request status changes
- Email notifications for confirmed requests
- Request expiration logic (auto-expire after X days)
- View count cache to reduce database queries
- Advanced analytics dashboards
- Request chat/messaging system
