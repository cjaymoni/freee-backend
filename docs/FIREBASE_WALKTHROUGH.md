# Walkthrough: Firebase Auth & Notifications Integration

I have successfully integrated Firebase into the backend to handle phone verification and push notifications.

## Changes Made

### 1. Database Schema

- [x] Renamed `is_verified` to `is_email_verified` in `UserEntity`.
- [x] Added `is_phone_verified` boolean field.
- [x] Added `fcm_token` text field for push notifications.
- [x] Generated and ran migration `AddFirebaseAndDualVerification`.

### 2. Firebase Module

- [x] Created `FirebaseModule` and `FirebaseService`.
- [x] Implemented token verification using `firebase-admin`.
- [x] Implemented FCM notification sending logic.

### 3. Authentication & User Endpoints

- [x] Added `POST /auth/firebase-login` to handle Firebase ID tokens (starts search by email/phone or creates new user).
- [x] Added `PATCH /user/fcm-token` to update device tokens.

## Verification Results

### Build & Compilation

- Full project build successful (`npm run build`).

### Database Migration

The migration was successfully applied to the Neon PostgreSQL database.

```sql
ALTER TABLE "users" DROP COLUMN "is_verified";
ALTER TABLE "users" ADD "is_email_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD "is_phone_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD "fcm_token" text;
```

---

## How to Verify

### 1. Firebase Configuration

Ensure your `.env` contains either `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`.

### 2. Test Firebase Login

You can test the endpoint using a Firebase ID token (generated from a mobile app or test script):

```bash
curl -X POST http://localhost:3000/auth/firebase-login \
  -H "Content-Type: application/json" \
  -d '{"idToken": "YOUR_FIREBASE_ID_TOKEN"}'
```

### 3. Update FCM Token

```bash
curl -X PATCH http://localhost:3000/user/fcm-token \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fcm_token": "TEST_FCM_TOKEN"}'
```
