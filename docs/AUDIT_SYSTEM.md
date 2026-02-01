# Audit System Documentation

## Overview

The audit system provides comprehensive tracking of all actions in the system through three specialized tables:

1. **audit_logs** - Tracks all entity changes (CRUD operations)
2. **system_events** - Tracks system-level events (cron jobs, batch processes, system alerts)
3. **user_activity_log** - Tracks user activities (logins, searches, page views)

## Architecture

### Entities

#### AuditLogEntity

Tracks all entity changes with before/after values:

- `user_id` - User who performed the action (null for system actions)
- `entity_type` - Type of entity (items, users, categories, etc.)
- `entity_id` - ID of the entity affected
- `action` - Type of action (created, updated, deleted, viewed)
- `old_values` - State before change (JSON)
- `new_values` - State after change (JSON)
- `changed_fields` - Array of field names that changed
- `ip_address`, `user_agent` - Request metadata
- `api_endpoint`, `request_method` - API details
- `success` - Whether the action succeeded
- `error_message` - Error details if failed
- `metadata` - Additional context

#### SystemEventEntity

Tracks system-level operations:

- `event_type` - scheduled_job, batch_process, system_alert
- `event_name` - Name of the event
- `status` - started, completed, failed
- `description` - Event description
- `affected_records` - Number of records affected
- `duration_ms` - Duration in milliseconds
- `error_message` - Error details if failed
- `metadata` - Additional context

#### UserActivityLogEntity

Tracks user activities for analytics:

- `user_id` - User performing the activity
- `activity_type` - login, logout, search, view_item, message_sent, etc.
- `resource_type` - Type of resource (item, user, conversation)
- `resource_id` - ID of the resource
- `ip_address`, `device_type` - User context
- `session_id` - Reference to user session
- `duration_seconds` - Duration of activity
- `metadata` - Additional context (search terms, filters, etc.)

### Services

#### AuditService

Primary service for logging audit events:

```typescript
// Manual audit logging
await this.auditService.log({
  userId: user.userId,
  entityType: 'items',
  entityId: item.id,
  action: 'updated',
  oldValues: { status: 'available', price: 100 },
  newValues: { status: 'reserved', price: 100 },
  ipAddress: request.ip,
  userAgent: request.headers['user-agent'],
  apiEndpoint: '/items/123',
  requestMethod: 'PATCH',
  success: true,
  metadata: { reason: 'user reservation' },
});

// Query audit logs
const { logs, total } = await this.auditService.findAll({
  userId: '123',
  entityType: 'items',
  action: 'deleted',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-12-31'),
  limit: 100,
  offset: 0,
});

// Get entity history
const history = await this.auditService.getEntityHistory(
  'items',
  'item-id-123',
);
```

#### SystemEventService

Service for tracking system events:

```typescript
// Start tracking an event
const event = await this.systemEventService.startEvent(
  SystemEventType.BATCH_PROCESS,
  'Daily Item Cleanup',
  'Removing expired items',
);

try {
  // Perform the operation
  const deletedCount = await this.cleanupExpiredItems();

  // Mark as completed
  await this.systemEventService.completeEvent(
    event.id,
    deletedCount,
    Date.now() - startTime,
  );
} catch (error) {
  // Mark as failed
  await this.systemEventService.failEvent(
    event.id,
    error.message,
    Date.now() - startTime,
  );
}

// Query events
const events = await this.systemEventService.findAll({
  eventType: SystemEventType.SCHEDULED_JOB,
  status: SystemEventStatus.FAILED,
  startDate: new Date('2024-01-01'),
  limit: 50,
});
```

#### UserActivityService

Service for tracking user activities:

```typescript
// Log user activity
await this.userActivityService.log({
  userId: user.userId,
  activityType: 'search',
  resourceType: 'items',
  ipAddress: request.ip,
  deviceType: 'mobile',
  sessionId: request.session?.id,
  metadata: {
    searchTerm: 'furniture',
    filters: { category: 'home' },
    resultsCount: 25,
  },
});

// Get user activity history
const activities = await this.userActivityService.getUserActivity(user.userId, {
  activityType: 'view_item',
  startDate: new Date('2024-01-01'),
  limit: 100,
});

// Get activity statistics
const stats = await this.userActivityService.getActivityStats(
  user.userId,
  new Date('2024-01-01'),
  new Date('2024-12-31'),
);
// Returns: [{ activityType: 'search', count: 150 }, ...]
```

## Automatic Auditing with Interceptor

The `AuditInterceptor` automatically logs all POST, PUT, PATCH, DELETE requests:

### Global Application (Optional)

```typescript
// In main.ts
app.useGlobalInterceptors(new AuditInterceptor(auditService));
```

### Module-Level Application

```typescript
// In a specific module
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class ItemModule {}
```

### Controller-Level Application

```typescript
@Controller('items')
@UseInterceptors(AuditInterceptor)
export class ItemController {
  // All routes in this controller will be audited
}
```

The interceptor automatically:

- Extracts entity information from URLs
- Captures request/response data
- Logs success and failures
- Records execution duration
- Skips GET requests and health checks

## Manual Auditing Examples

### Example 1: Item Creation with Audit

```typescript
@Post()
async create(
  @Body() createItemDto: CreateItemDto,
  @GetUser('userId') userId: string,
  @Req() request: Request,
) {
  const item = await this.itemService.create(createItemDto, userId);

  // Manual audit log
  await this.auditService.log({
    userId,
    entityType: 'items',
    entityId: item.id,
    action: 'created',
    newValues: item,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    apiEndpoint: '/items',
    requestMethod: 'POST',
    success: true,
  });

  return item;
}
```

### Example 2: Item Update with Change Tracking

```typescript
@Patch(':id')
async update(
  @Param('id') id: string,
  @Body() updateItemDto: UpdateItemDto,
  @GetUser('userId') userId: string,
  @Req() request: Request,
) {
  // Get old state
  const oldItem = await this.itemService.findOne(id);

  // Perform update
  const newItem = await this.itemService.update(id, updateItemDto);

  // Log with before/after comparison
  await this.auditService.log({
    userId,
    entityType: 'items',
    entityId: id,
    action: 'updated',
    oldValues: oldItem,
    newValues: newItem,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    apiEndpoint: `/items/${id}`,
    requestMethod: 'PATCH',
    success: true,
  });

  return newItem;
}
```

### Example 3: Soft Delete with Audit

```typescript
@Delete(':id')
async remove(
  @Param('id') id: string,
  @GetUser('userId') userId: string,
  @Req() request: Request,
) {
  const item = await this.itemService.findOne(id);

  await this.itemService.softDelete(id);

  await this.auditService.log({
    userId,
    entityType: 'items',
    entityId: id,
    action: 'deleted',
    oldValues: item,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    apiEndpoint: `/items/${id}`,
    requestMethod: 'DELETE',
    success: true,
    metadata: {
      deletionType: 'soft',
      reason: 'user request',
    },
  });

  return { message: 'Item deleted successfully' };
}
```

### Example 4: User Activity Tracking

```typescript
@Get(':id')
async findOne(
  @Param('id') id: string,
  @GetUser() user: any,
  @Req() request: Request,
) {
  const item = await this.itemService.findOne(id);

  // Log user activity (not an audit log)
  if (user) {
    await this.userActivityService.log({
      userId: user.userId,
      activityType: 'view_item',
      resourceType: 'items',
      resourceId: id,
      ipAddress: request.ip,
      deviceType: this.detectDeviceType(request.headers['user-agent']),
      sessionId: request.session?.id,
      metadata: {
        itemTitle: item.title,
        itemCategory: item.category?.name,
      },
    });
  }

  return item;
}
```

## Admin Endpoints

### View Audit Logs (Admin Only)

```bash
# Get all audit logs with filters
GET /audit?userId=123&entityType=items&action=deleted&limit=100

# Get entity history
GET /audit/entity/items/item-id-123

# Response
{
  "logs": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "entity_type": "items",
      "entity_id": "uuid",
      "action": "updated",
      "old_values": { "status": "available" },
      "new_values": { "status": "reserved" },
      "changed_fields": ["status"],
      "ip_address": "192.168.1.1",
      "api_endpoint": "/items/123",
      "success": true,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 1
}
```

## Use Cases

### 1. Security Monitoring

```typescript
// Track suspicious deletions
const suspiciousDeletes = await this.auditService.findAll({
  action: 'deleted',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
});

// Find failed login attempts
const failedLogins = await this.auditService.findAll({
  entityType: 'users',
  action: 'login',
  success: false,
});
```

### 2. Compliance & GDPR

```typescript
// Export all user data (for GDPR requests)
const userAuditTrail = await this.auditService.findAll({
  userId: 'user-id-123',
});

const userActivities =
  await this.userActivityService.getUserActivity('user-id-123');
```

### 3. Debugging & Support

```typescript
// Find what changed when an item broke
const itemHistory = await this.auditService.getEntityHistory(
  'items',
  'broken-item-id',
);

// See what user was doing before error
const recentActivity = await this.userActivityService.getUserActivity(
  'user-id-123',
  { limit: 50 },
);
```

### 4. Analytics & Reporting

```typescript
// Most active users
const activityStats = await this.userActivityService.getActivityStats(
  'user-id',
  startDate,
  endDate,
);

// System health monitoring
const failedJobs = await this.systemEventService.findAll({
  eventType: SystemEventType.SCHEDULED_JOB,
  status: SystemEventStatus.FAILED,
});
```

## Database Indexes

All tables are optimized with indexes for common queries:

### audit_logs

- `user_id` - Find all actions by user
- `entity_type` - Find all actions on entity type
- `entity_id` - Find all actions on specific entity
- `action` - Find all actions of specific type
- `created_at` - Time-based queries
- Composite: `(entity_type, entity_id, created_at)` - Entity history
- Composite: `(user_id, created_at)` - User timeline
- Composite: `(entity_type, action, created_at)` - Action analysis

### system_events

- `event_type` - Filter by event type
- `status` - Filter by status
- `created_at` - Time-based queries
- Composite: `(event_type, status, created_at)` - Event monitoring

### user_activity_log

- `user_id` - Find user activities
- `activity_type` - Filter by activity type
- `created_at` - Time-based queries
- `session_id` - Session tracking
- Composite: `(user_id, activity_type, created_at)` - User behavior
- Composite: `(activity_type, created_at)` - Activity trends

## Data Retention

As per table notes:

### audit_logs

- Partition by `created_at` (monthly)
- Archive to cold storage after 12 months
- Keep critical actions (delete, role_change) permanently

### user_activity_log

- Partition by `created_at` (weekly)
- Auto-delete after 90 days (GDPR compliance)
- Used for analytics and user behavior patterns

### system_events

- Track cron jobs, batch updates, system health events
- Retain indefinitely for system monitoring

## Implementation Checklist

- [x] Create audit entities (audit_logs, system_events, user_activity_log)
- [x] Create audit services
- [x] Create audit interceptor for automatic logging
- [x] Create admin controller for viewing logs
- [x] Generate database migration
- [ ] Run migration: `npm run migration:run`
- [ ] (Optional) Enable global interceptor in main.ts
- [ ] Add manual audit logging to critical endpoints
- [ ] Set up data retention policies
- [ ] Configure log archival process
- [ ] Set up monitoring alerts for failed system events

## Next Steps

1. **Run Migration**

   ```bash
   npm run migration:run
   ```

2. **Enable Global Auditing (Optional)**

   ```typescript
   // In main.ts
   const auditService = app.get(AuditService);
   app.useGlobalInterceptors(new AuditInterceptor(auditService));
   ```

3. **Add Manual Audit Logs to Critical Operations**
   - User role changes
   - Item deletions
   - Payment transactions
   - Account suspensions

4. **Set Up Monitoring**
   - Create dashboard for failed system events
   - Alert on suspicious audit patterns
   - Monitor user activity trends

5. **Configure Data Retention**
   - Set up automated archival process
   - Implement partition management
   - Configure GDPR-compliant deletion

## Security Considerations

1. **Access Control**
   - Only admins can view audit logs
   - Audit logs are immutable (no update/delete endpoints)
   - System event access can be restricted further if needed

2. **PII Handling**
   - Be careful with `old_values`/`new_values` containing sensitive data
   - Consider encrypting sensitive fields
   - Implement GDPR-compliant deletion for user activity logs

3. **Performance**
   - Audit logging is non-blocking (failures don't break app)
   - Indexes optimize query performance
   - Partitioning recommended for large datasets

4. **Completeness**
   - Critical operations should have manual audit logs
   - Interceptor provides baseline coverage
   - System events track batch operations
