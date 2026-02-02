# Moderation Module

## Overview
Complete moderation system with user suspension and complaint/appeal mechanism for suspended users.

## Features

### 1. Report Items
- Users can report inappropriate items
- Priority levels: low, medium, high, urgent
- Status tracking: pending, in_review, resolved, dismissed

### 2. Report Users
- Users can report other users for violations
- Same priority and status tracking as items
- Cannot report yourself

### 3. Block Users
- Users can block other users
- Soft delete support (can unblock)
- Unique constraint prevents duplicate blocks
- Cannot block yourself

### 4. Admin Moderation
- Review and resolve reports
- Take actions: item_removed, user_warned, no_action
- Track resolution notes and timestamps

### 5. Complaint System
- Suspended users can lodge complaints
- Complaint types: blocked, reported, item_removed, account_suspended
- Admin review and response system

## State Management

### When Item is Removed (action_taken: 'item_removed')
- Item status → `UNAVAILABLE`
- Item `is_deleted` → `true`
- Item `deleted_at` → current timestamp
- Item `deleted_by` → reviewer ID
- Item `deletion_reason` → "Removed due to moderation"

### When User is Suspended (action_taken: 'item_removed' on user report)
- User `is_active` → `false`
- User CANNOT access normal system features
- User CAN ONLY access complaint endpoints

## API Endpoints

### User Endpoints
```
POST   /moderation/items/report          - Report an item
POST   /moderation/users/report          - Report a user
POST   /moderation/users/block           - Block a user
DELETE /moderation/users/block/:blockedId - Unblock a user
GET    /moderation/users/blocked         - Get blocked users list
```

### Complaint Endpoints (Available to Suspended Users)
```
POST /moderation/complaints     - Lodge a complaint
GET  /moderation/complaints/my  - Get my complaints
```

### Admin Endpoints
```
PATCH /moderation/items/report/:id/resolve - Resolve item report
PATCH /moderation/users/report/:id/resolve - Resolve user report
GET   /moderation/items/reports?status=pending - Get item reports
GET   /moderation/users/reports?status=pending - Get user reports
GET   /moderation/complaints?status=pending - Get all complaints
PATCH /moderation/complaints/:id/resolve - Resolve complaint
```

## Database Tables

### reported_items
- Tracks item reports with priority queue
- Indexed for efficient moderation queue queries
- Foreign keys to items, users (reporter, reviewer)

### reported_users
- Tracks user reports with priority queue
- Similar structure to reported_items
- Foreign keys to users (reported, reporter, reviewer)

### blocked_users
- Manages user blocking relationships
- Soft delete support
- Unique constraint on (blocker_id, blocked_id, is_deleted)

### moderation_complaints
- Tracks complaints from suspended users
- Links to original report/block via reference_id
- Admin response and resolution tracking

## Usage Examples

### Report a User
```typescript
POST /moderation/users/report
{
  "reportedUserId": "uuid",
  "reason": "Spam",
  "description": "Sending spam messages",
  "priority": "high"
}
```

### Resolve Report & Suspend User (Admin)
```typescript
PATCH /moderation/users/report/:id/resolve
{
  "status": "resolved",
  "actionTaken": "item_removed",
  "resolutionNotes": "User violated terms of service"
}
// User is now suspended (is_active = false)
```

### Lodge Complaint (Suspended User)
```typescript
POST /moderation/complaints
{
  "complaintType": "account_suspended",
  "referenceId": "report-uuid",
  "subject": "Wrongful suspension",
  "description": "I believe my account was suspended by mistake..."
}
```

### Resolve Complaint (Admin)
```typescript
PATCH /moderation/complaints/:id/resolve
{
  "status": "resolved",
  "adminResponse": "After review, we've reinstated your account."
}
// Admin can manually update user.is_active = true if complaint is valid
```

## Migration
Run the migration to create tables:
```bash
npm run migration:run
```

## Dependencies
- ItemModule (for removing items)
- UserModule (for suspending users)
- AuthModule (for JWT authentication)
