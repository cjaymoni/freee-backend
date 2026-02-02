# Testing Suspended User Access Control

## Overview
This guide explains how to verify that suspended users cannot access normal system endpoints but can access complaint endpoints.

## Setup

### 1. Apply the ActiveUserGuard Globally (Optional)
To protect all endpoints by default, add the guard to `app.module.ts`:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { ActiveUserGuard } from './auth/guards/active-user.guard';

@Module({
  // ... other config
  providers: [
    // ... other providers
    {
      provide: APP_GUARD,
      useClass: ActiveUserGuard,
    },
  ],
})
export class AppModule {}
```

### 2. Or Apply Per Controller
Add `@UseGuards(JwtAuthGuard, ActiveUserGuard)` to controllers that should block suspended users.

## Testing Steps

### Step 1: Create and Suspend a User

1. **Register a user:**
```bash
POST /auth/register
{
  "email": "test@example.com",
  "password": "Password123!",
  "phone_number": "+1234567890"
}
```

2. **Verify email and login**

3. **Report the user (as another user):**
```bash
POST /moderation/users/report
Authorization: Bearer <admin_token>
{
  "reportedUserId": "<user_id>",
  "reason": "Testing suspension",
  "description": "Test case",
  "priority": "high"
}
```

4. **Resolve report and suspend user (as admin):**
```bash
PATCH /moderation/users/report/<report_id>/resolve
Authorization: Bearer <admin_token>
{
  "status": "resolved",
  "actionTaken": "item_removed",
  "resolutionNotes": "User suspended for testing"
}
```

### Step 2: Verify Suspended User Cannot Access Normal Endpoints

Try accessing any normal endpoint with the suspended user's token:

```bash
# Should FAIL with 403 Forbidden
GET /items
Authorization: Bearer <suspended_user_token>

# Expected Response:
{
  "statusCode": 403,
  "message": "Your account has been suspended. You can only access complaint endpoints."
}
```

```bash
# Should FAIL with 403 Forbidden
POST /items
Authorization: Bearer <suspended_user_token>
{
  "title": "Test Item",
  ...
}
```

```bash
# Should FAIL with 403 Forbidden
GET /user/profile
Authorization: Bearer <suspended_user_token>
```

### Step 3: Verify Suspended User CAN Access Complaint Endpoints

```bash
# Should SUCCEED
POST /moderation/complaints
Authorization: Bearer <suspended_user_token>
{
  "complaintType": "account_suspended",
  "subject": "Wrongful suspension",
  "description": "I believe my account was suspended by mistake..."
}

# Expected Response:
{
  "id": "<complaint_id>",
  "userId": "<user_id>",
  "status": "pending",
  ...
}
```

```bash
# Should SUCCEED
GET /moderation/complaints/my
Authorization: Bearer <suspended_user_token>

# Expected Response:
[
  {
    "id": "<complaint_id>",
    "complaintType": "account_suspended",
    "status": "pending",
    ...
  }
]
```

### Step 4: Verify Active Users Can Access Everything

```bash
# Should SUCCEED
GET /items
Authorization: Bearer <active_user_token>

# Should SUCCEED
POST /moderation/complaints
Authorization: Bearer <active_user_token>
{...}
```

## Endpoints Protected by ActiveUserGuard

All endpoints EXCEPT those marked with `@AllowSuspended()`:
- ✅ `/moderation/complaints` (POST) - Suspended users can lodge complaints
- ✅ `/moderation/complaints/my` (GET) - Suspended users can view their complaints
- ❌ All other endpoints - Suspended users are blocked

## Database Verification

Check user status in database:
```sql
SELECT id, email, is_active FROM users WHERE email = 'test@example.com';
-- is_active should be false for suspended users
```

Check complaints:
```sql
SELECT * FROM moderation_complaints WHERE user_id = '<user_id>';
```

## Reactivating a User

To reactivate a suspended user (as admin):
```sql
UPDATE users SET is_active = true WHERE id = '<user_id>';
```

Or programmatically:
```typescript
await userService.update(userId, { is_active: true });
```

## Expected Behavior Summary

| User Status | Normal Endpoints | Complaint Endpoints |
|-------------|------------------|---------------------|
| Active (is_active=true) | ✅ Allowed | ✅ Allowed |
| Suspended (is_active=false) | ❌ Blocked (403) | ✅ Allowed |
| Not Authenticated | ❌ Blocked (401) | ❌ Blocked (401) |

## Troubleshooting

### Issue: Suspended user can still access normal endpoints
- Verify `ActiveUserGuard` is applied to the controller/globally
- Check JWT strategy includes `is_active` in user object
- Verify user's `is_active` is actually `false` in database

### Issue: Active user gets 403 error
- Check user's `is_active` status in database
- Verify JWT token is valid and not expired
- Check if user was recently suspended

### Issue: Suspended user cannot access complaint endpoints
- Verify `@AllowSuspended()` decorator is on the endpoint
- Check guard order: `@UseGuards(JwtAuthGuard, ActiveUserGuard)`
