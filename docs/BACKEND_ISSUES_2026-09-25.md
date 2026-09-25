# Confirmed backend issues — 2026-09-25

Scope: free-backend (NestJS) as deployed at `https://api.freeee.app`, consumed by the Android app and free-backoffice.

**How issues were confirmed.** Each issue below was confirmed by one or more of:

- **Repro** — a throwaway jest spec run against the real services, and where noted against a real Postgres built from all migrations in `src/migrations` (the same schema production gets: `synchronize` is off when `DATABASE_URL` is set, `src/config/typeorm.config.ts:37`). The specs were deleted afterwards.
- **Live** — a read-only, unauthenticated GET to `https://api.freeee.app`.
- **Trace** — a deterministic code path, with file:line references.

No writes were made to the live API or the Neon database. Suspected problems that could not be confirmed are left out.

Severity key: **Critical** = account takeover. **High** = security/privacy or a core flow broken. **Medium** = wrong data or a broken UX in an implemented flow. **Low** = edge cases and wrong status codes.

| # | Severity | Status | Title |
|---|---|---|---|
| 1 | Critical | Fixed | Any signed-in user can overwrite another account (incl. password) via `POST /user` |
| 2 | High | Fixed | Suspended / deactivated users keep full access |
| 3 | High | Fixed | `POST /auth/logout` does not end the session |
| 4 | High | Fixed | Firebase sign-in links to an account with an unverified matching email |
| 5 | High | Fixed | `PATCH /user/:id` allows password change without current password and writes internal fields |
| 6 | High | Fixed | `POST /firebase-auth/revoke-sessions` is unauthenticated |
| 7 | High | Fixed | Any user can make the server delete any Cloudinary asset |
| 8 | High | Fixed | `GET /item-views/history` leaks item owners' private account fields |
| 9 | High | Fixed | Unblocking the same user a second time fails with 500; the block becomes permanent |
| 10 | Medium | Fixed | `GET /moderation/users/blocked` leaks private fields of blocked users |
| 11 | Medium | Fixed | Deleted items can be revived and handed over through item requests |
| 12 | Medium | Fixed | Owner can un-reserve via `PUT /items/:id`, allowing two confirmed requests and two pickups |
| 13 | Medium | Fixed | Blocked users can still push item-request messages and notifications to the blocker |
| 14 | Medium | Fixed | Socket dropped during handshake leaves user "online" forever; their chat pushes stop |
| 15 | Medium | Fixed | Invalid socket payloads get no ack, only a generic "Internal server error" |
| 16 | Medium | Fixed | Error responses don't match the documented `ApiError` envelope |
| 17 | Medium | Fixed | Item listings show the wrong poster `items_count` |
| 18 | Medium | Fixed | Item images are returned in arbitrary order |
| 19 | Medium | Fixed | Saved-items list: `is_saved:false`, deleted items and deleted images returned |
| 20 | Medium | Fixed | `featured_until` is never enforced |
| 21 | Medium | Fixed | Editing coordinates can move another user's item location |
| 22 | Medium | Fixed | Wrong code on verify-email / reset-password returns 500 instead of 400 |
| 23 | Medium | Fixed | Changing email/phone to one already in use returns 500 with raw DB error |
| 24 | Low | Fixed | Other pending requests stay pending forever after pickup |
| 25 | Low | Fixed | Moderation queue sorts priority alphabetically |
| 26 | Low | Fixed | Resolving a second report with `item_removed` returns 404; report stays pending |
| 27 | Low | Fixed | Audit log mislabels moderation actions and skips item requests / complaints |
| 28 | Low | Fixed | `POST /item-views` ignores the logged-in user; views double-counted |
| 29 | Low | Fixed | Re-creating a deleted category's slug returns 500 |
| 30 | Low | Fixed | Category parent cycles make both categories vanish |
| 31 | Low | Fixed | Deleted/inactive categories still returned via category detail and items |
| 32 | Low | Fixed | `is_free` defaults to true even when a price is set |
| 33 | Low | Fixed | `items.category_id` has no foreign key |
| 34 | Low | Fixed | Chat history pagination skips messages in the cursor's millisecond |
| 35 | Low | Fixed | Malformed ids/enums on public item/category/view endpoints return 500 |
| 36 | Low | Fixed | Item-request pagination and reports on missing targets return 500 |
| 37 | Low | Fixed | Preference endpoints skip body validation; bad input returns 500 |
| 38 | Low | Fixed | Audit log filters with a non-UUID return 500 |
| 39 | Low | Fixed | View stats dates shifted a day for UTC clients |


## Fix status

All 39 issues are fixed on branch `fix/backend-issues`. Each section below says how, and how the fix was verified. Summary:

- **Tests:** 255 tests pass (131 before), and `tsc` is clean. Lint errors in the changed files went down (131 → 121), and none were introduced.
- **Verification:** the database-dependent fixes were replayed against a local Postgres built from all migrations. For the fixes that had a before/after comparison, that comparison is recorded.

### Deploy notes

- There are two new migrations. Both run automatically on start in production (`migrationsRun`):
  - `1791000000000-UniqueActiveBlock` (#9)
  - `1792000000000-AddItemsCategoryForeignKey` (#33), which first clears dangling `items.category_id` values
- Neither migration needs downtime. Both revert cleanly.

### Changes client teams should know about

Android and backoffice should review these:

| Change | Issue |
|---|---|
| `POST /user` only updates the signed-in user. Another account's email or phone returns 409, and a password is rejected if one is already set. | #1 |
| Suspended/deactivated users get **403** on everything except complaints, `GET /auth/me` and logout. Sign-in and refresh still work. | #2 |
| `PATCH /user/:id` (self) ignores non-profile fields, with a `warnings` entry, and ignores `password` once one is set; use `/auth/change-password`. | #5 |
| `POST /firebase-auth/revoke-sessions` needs a bearer token and only revokes your own sessions (admins: any). | #6 |
| `POST /items/:itemId/images` only accepts unused `items/…` Cloudinary ids. | #7 |
| `PUT /items/:id` returns 409 when setting or leaving `reserved`/`picked_up`. Cancel the request instead. | #12 |
| Creating a request between blocked users returns 403. | #13 |
| Invalid socket payloads now get an ack `{state:false, statusCode:400, message, client_message_id}`. | #15 |
| Every HTTP error has `state:false`, `data:null`, `message`, `error`, `statusCode`. Validation errors still use a `message` array. | #16 |
| `is_featured` is false once `featured_until` passes, and the feature endpoint rejects past dates. | #20 |
| `location_id` must be your own saved location or an unused temporary one (403 otherwise). | #21 |
| After pickup, the other pending requests become `cancelled`. | #24 |
| Unknown `category_id` on items returns 400. | #33 |
| Malformed ids, enums and paging values return 400, and missing report/block targets return 404. | #35–#37 |
| `views_by_date[].date` is `"YYYY-MM-DD"`. | #39 |
| Backoffice copy still says suspended users are "signed out" / "can't sign in". It should say they can only lodge complaints. | #2 |

---

## 1. Any signed-in user can overwrite another account (incl. password) via `POST /user`

- **Severity:** Critical
- **Affected flow:** Onboarding / create user profile
- **Endpoint / data area:** `POST /user`; `users` table
- **Expected result:** A caller can only create or complete their own profile.
- **Actual result:** The endpoint only requires a valid JWT and never compares the body to the caller. It runs with `upsertOnConflict: true`, finds any existing user whose `email`, `phone_number` or `firebase_uid` matches the body, and patches that row. The patch covers names, email, phone, firebase_uid, `is_onboarded`, avatar and `password_hash`.
- **Reproduction steps:**
  1. Sign in as ordinary user B.
  2. `POST /user` with `{"email":"<admin's email>","password":"Hacked123!","first_name":"pwned"}`. The response is 200 "User updated successfully", and the returned id is the admin's.
  3. `POST /auth/login` with the admin's email and `Hacked123!` succeeds with role ADMIN. The admin's real password now returns 401.
- **Platform impact:** Both. This allows backoffice admin takeover and corrupts any user's data.
- **Evidence:** `src/user/user.controller.ts:75,133-147`; `src/user/user.service.ts:165-183,201-231,255`; `src/user/dto/create-user.dto.ts:6-20`
- **Confirmed by:** Repro against the migrated Postgres.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `POST /user` now passes the caller's id from the JWT (`actingUserId`) instead of `upsertOnConflict`. The service always patches the caller's own row and never looks up an account from the email, phone or firebase_uid in the body (`src/user/user.controller.ts`, `UserService.loadOwnProfileForPatch` in `src/user/user.service.ts`).
  - An email or phone that belongs to another account returns **409**.
  - A `password` when the account already has one returns **400** "use /auth/change-password". First-time password setup during onboarding still works.
  - `firebase_uid` from the body is ignored; the backend sets it at sign-in.
  - Changing email or phone through this endpoint clears the matching `is_*_verified` flag.
  - The Firebase sign-in path, which also uses `create()`, is unchanged here; it is covered by #4.
  - Tests: 4 cases in `src/user/user.service.spec.ts` ("UserService.create from POST /user").

## 2. Suspended / deactivated users keep full access

- **Severity:** High
- **Affected flow:** Moderation → suspend user; backoffice Users → deactivate
- **Endpoint / data area:** `PATCH /moderation/users/report/:id/resolve` (`actionTaken: user_suspended`) and `PATCH /user/:id {is_active:false}`. Afterwards the user still reaches `/item-requests/*`, `/items/*`, `/saved-items`, `/user/*`, `/auth/refresh` and `/firebase-auth/authenticate`.
- **Expected result:** A suspended account gets 403 everywhere except the complaint endpoints, and is signed out. See `src/moderation/README.md:45-48` and `TESTING.md:154-157`. The backoffice tells admins "The account will be deactivated and the user signed out" and "Deactivated users can't sign in".
- **Actual result:**
  - `ActiveUserGuard` is applied only to `ModerationController` and `ChatController`. There is no global guard.
  - Deactivation does not revoke sessions.
  - `JwtStrategy.validate` only copies `is_active` onto `req.user`.
  - `refresh()` and `firebaseAuthenticate()` never check `is_active`.
  - Result: suspended users can keep posting, requesting and handing over items. They can also get new tokens.
- **Reproduction steps:**
  1. Admin suspends user U via the resolve endpoint above.
  2. U, with their existing access token, sends `POST /item-requests {"item_id":"<any available item>"}`. The response is 201; 403 is expected.
  3. U calls `POST /auth/refresh` or `POST /firebase-auth/authenticate`. It succeeds and returns fresh tokens.
- **Platform impact:** Android (suspended users keep using the app). Backoffice (the suspend/deactivate action has no effect).
- **Evidence:** `src/item-request/item-request.controller.ts:34`; `src/chat/chat.controller.ts:48` and `src/moderation/moderation.controller.ts:30` are the only uses of `ActiveUserGuard`; `src/app.module.ts:118-124`; `src/auth/strategies/jwt.strategy.ts:33-49`; `src/auth/auth.service.ts:297-466,616-660`; `src/user/user.service.ts:501-590`; `src/moderation/moderation.service.ts:148`
- **Confirmed by:** Repro (guard metadata; an `is_active=false` user authenticating successfully) and trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `JwtAuthGuard` now rejects `is_active=false` accounts with **403** "Your account has been suspended…" after a token is validated (`src/auth/guards/jwt-auth.guard.ts`). Every JWT-protected route enforces suspension without opting in, including item requests, items, saved items and user endpoints.
  - The exemptions are marked `@AllowSuspended()`: complaint create/list-mine (already marked), `GET /auth/me` (so the app can show the suspended state), and `POST /auth/logout`. The decorator is now honoured on controllers as well as handlers.
  - Sign-in and `/auth/refresh` still work on purpose, so a suspended user can still lodge a complaint as `src/moderation/README.md` requires. They can't use any other feature.
  - The chat socket already refused inactive users on connect.
  - Tests: `src/auth/guards/jwt-auth.guard.spec.ts` (4 cases).
  - Follow-up outside the backend: the backoffice tells admins suspended users are "signed out" and "can't sign in". The copy should say they are blocked from everything except complaints.

## 3. `POST /auth/logout` does not end the session

- **Severity:** High
- **Affected flow:** Logout (Android and backoffice)
- **Endpoint / data area:** `POST /auth/logout`; `user_sessions`
- **Expected result:** The current session is deactivated and its refresh token stops working. This is documented in `docs/ANDROID_INTEGRATION.md:400`.
- **Actual result:** `JwtStrategy` sets `req.user.sessionToken`, but the controller reads `user.session_token`, which is `undefined`. The resulting `UPDATE ... WHERE session_token = undefined` matches no rows. The session stays active, and the 7-day refresh token keeps minting new access tokens.
- **Reproduction steps:**
  1. `POST /auth/login` and keep the `refresh_token`.
  2. `POST /auth/logout` with the access token. The response is 200.
  3. `POST /auth/refresh` with the same refresh token. It still returns a new `access_token` and `refresh_token`.
- **Platform impact:** Both. The backoffice logout route only clears cookies, so the server-side session stays valid.
- **Evidence:** `src/auth/strategies/jwt.strategy.ts:42-49`; `src/auth/auth.controller.ts:176-177`; `src/auth/auth.service.ts:719-723`
- **Confirmed by:** Repro, including the generated SQL.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `AuthController.logout` now reads `user.sessionToken`, the field `JwtStrategy.validate` actually sets, instead of `session_token` (`src/auth/auth.controller.ts`). The session row is deactivated, and because `/auth/refresh` only accepts refresh tokens of active sessions, the refresh token stops working too.
  - `AuthService.logout` now throws 401 when no session token is given, so this can't silently no-op again.
  - The backoffice's `/api/auth/logout` already calls the backend, so it benefits without changes.
  - Tests: `src/auth/auth.controller.spec.ts`.

## 4. Firebase sign-in links to an account with an unverified matching email

- **Severity:** High
- **Affected flow:** Google/Firebase sign-in, account linking
- **Endpoint / data area:** `POST /firebase-auth/authenticate`, `POST /auth/firebase-login`; `users.firebase_uid`
- **Expected result:** A first-time Google sign-in either gets its own account or links only to an account whose email is verified.
- **Actual result:** When no user matches the Firebase uid, the code falls back to matching on email or phone. It links to that row and overwrites its `firebase_uid` without checking `is_email_verified`. Any user can put an arbitrary email on their own account via `PATCH /user/:id`, and it is stored unverified.
- **Reproduction steps:**
  1. User A (a phone-auth account) sends `PATCH /user/A {"email":"victim@gmail.com"}`. The row now has `is_email_verified=false`.
  2. The victim signs in with Google as victim@gmail.com for the first time.
  3. The response is A's user id, and A's `firebase_uid` is overwritten with the victim's. The victim lands in A's account.
- **Platform impact:** Android.
- **Evidence:** `src/auth/auth.service.ts:301-325`; `src/user/user.service.ts:532-538`; `src/user/user.controller.ts:378-384`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - A first-time Firebase sign-in (no row with that `firebase_uid`) now goes through `AuthService.resolveFirebaseLink` (`src/auth/auth.service.ts`). An existing account is linked only when both sides have verified the identifier:
    - **Phone:** Firebase phone numbers are always verified, so it links to a row whose `is_phone_verified` is true.
    - **Email:** only when the token has `email_verified: true` and the row has `is_email_verified`.
  - If another account holds the same email or phone unverified, the claim is released: that row's identifier is cleared and the verified token holder gets a fresh account with it. Nobody can pre-claim a victim's email or number any more.
  - If the email is held verified by another account and the token can't prove ownership, the new account is created without that email.
  - The new-user `create()` call no longer uses `upsertOnConflict`, so it can't link by email or phone either. The concurrent-sign-in recovery now adopts only a row with the same `firebase_uid`.
  - Tests: `src/auth/auth.service.spec.ts` (4 cases).

## 5. `PATCH /user/:id` allows password change without current password and writes internal fields

- **Severity:** High
- **Affected flow:** Edit profile
- **Endpoint / data area:** `PATCH /user/:id` (a non-admin editing themselves)
- **Expected result:** Passwords change only via `/auth/change-password`, which needs `currentPassword` and a minimum length. Server-managed fields are not client-writable.
- **Actual result:** `UpdateUserDto` accepts `password` with no minimum length, plus `is_deleted`, `deleted_at`, `failed_login_attempts`, `account_locked_until`, `member_since`, `created_at`, `is_onboarded` and others. Only 5 fields are stripped for non-admins. If a user sets `is_deleted:true` themselves, the account is hidden from the admin list but can still sign in, its items stay live, and `DELETE /user/:id` then returns 404.
- **Reproduction steps:**
  1. As user U, send `PATCH /user/U` with `{"password":"x","is_deleted":true,"member_since":"2001-01-01"}`. The response is 200.
  2. Login with password "x" works, `member_since` has been rewritten, and U is missing from `GET /user` (admin).
- **Platform impact:** Both; also data integrity.
- **Evidence:** `src/user/dto/update-user.dto.ts:5-7`; `src/user/dto/base-user.dto.ts:48,107,145,178,186`; `src/user/user.controller.ts:56-62,378-384`; `src/user/user.service.ts:512-520,556,677-679`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - When a non-admin edits their own record, `PATCH /user/:id` now uses an **allowlist** instead of the old 5-field denylist (`SELF_EDITABLE_FIELDS` in `src/user/user.controller.ts`). The editable fields are: first/last name, email, phone, date of birth, gender, bio, avatar URL, `fcm_token` and `notification_enabled`.
  - Everything else is dropped and listed in `warnings`, as before, so clients that echo the whole profile back keep working. That includes `is_deleted`, `deleted_at`, lockout fields, `member_since`, `created_at`, `is_onboarded`, `requires_password_change` and `cloudinary_avatar_public_id`.
  - `password` is accepted only when the account has no password yet (first-time setup) and is at least 6 characters. If a password already exists, it is ignored with a warning pointing to `/auth/change-password`, which checks the current password.
  - Admin edits are unchanged.
  - Tests: `src/user/user.controller.spec.ts`. There are 7 new ignored-field cases, a case for ignoring a password replacement, and a case for a short first password.

## 6. `POST /firebase-auth/revoke-sessions` is unauthenticated

- **Severity:** High
- **Affected flow:** Firebase session management
- **Endpoint / data area:** `POST /firebase-auth/revoke-sessions {"email": "..."}`
- **Expected result:** Only the user themselves or an admin can revoke that user's sessions.
- **Actual result:** The controller has no guards and there is no global guard. Anyone who knows an email can revoke that user's Firebase refresh tokens. This signs the user out of the Firebase SDK on every device and blocks flows that need a fresh ID token, such as `PATCH /user/phone-number`. The live OpenAPI spec lists this route with no security requirement.
- **Reproduction steps:** Send `POST https://api.freeee.app/firebase-auth/revoke-sessions` with no `Authorization` header and body `{"email":"<victim>"}`. The victim's Firebase sessions are revoked. This step was not executed live because it is a write; the missing guard is confirmed in code and in the live `/api-json`.
- **Platform impact:** Android.
- **Evidence:** `src/auth/firebase-auth.controller.ts:18,101-106`; `src/auth/firebase-auth.service.ts:102-110`
- **Confirmed by:** Trace and the live OpenAPI spec.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `POST /firebase-auth/revoke-sessions` now requires a JWT (`JwtAuthGuard`, plus `@AllowSuspended()` so a suspended user can still sign themselves out everywhere).
  - Non-admins may only revoke their own sessions. Any other email, including one with no account, gets the same **403**, so the endpoint can't be used to probe which emails are registered. Admins can revoke anyone's.
  - `docs/FIREBASE_FRONTEND_INTEGRATION.md` already sends a bearer token here, so documented clients are unaffected.
  - Changed files: `src/auth/firebase-auth.controller.ts`, `src/auth/firebase-auth.service.ts`.
  - Tests: `src/auth/firebase-auth.service.spec.ts` (4 cases).

## 7. Any user can make the server delete any Cloudinary asset

- **Severity:** High
- **Affected flow:** Item photos (add/remove); user avatars
- **Endpoint / data area:** `POST /items/:itemId/images`, `DELETE /items/:itemId/images/:imageId`, `DELETE /items/:id`; Cloudinary
- **Expected result:** Deleting an image destroys only assets that belong to that item.
- **Actual result:** `POST /items/:itemId/images` stores a client-supplied `cloudinary_public_id` without checking it. The delete paths then call `cloudinary.uploader.destroy(publicId)` on that id. Avatar ids are predictable (`avatars/user_<userId>`), and user ids are public in `GET /items`.
- **Reproduction steps:**
  1. On your own item, send `POST /items/{myItem}/images` with `{"cloudinary_public_id":"avatars/user_<victimId>","cloudinary_url":"https://x/a.jpg","cloudinary_secure_url":"https://x/a.jpg"}`.
  2. Send `DELETE /items/{myItem}/images/{newImageId}`. The victim's avatar is destroyed on Cloudinary.
- **Platform impact:** Data (broken avatars and images on Android and backoffice).
- **Evidence:** `src/item/dto/create-item-image.dto.ts:13-16`; `src/item/item-image.service.ts:60-66,240-243`; `src/item/item.service.ts:698-716`; `src/cloudinary/cloudinary.service.ts:95-96,145-152`
- **Confirmed by:** Repro (the destroy call received `avatars/user_victim-id`) and trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `POST /items/:itemId/images` now accepts a `cloudinary_public_id` only if it is in the server's `items/` upload folder and not already used by any image row, including soft-deleted ones. Otherwise it returns 400 or 409 (`src/item/item-image.service.ts`).
  - Every item-image delete path passes only `items/…` ids to Cloudinary's destroy (`isItemImagePublicId` in `src/item/item-image-upload.options.ts`). Rows registered before this fix can't reach avatars or chat images either. The paths are:
    - single image delete
    - `remove_image_ids` on `PUT /items/:id`
    - item delete and admin remove
  - A related path through avatars is closed by #5: users could set `cloudinary_avatar_public_id` via `PATCH /user/:id`, and the next avatar upload would destroy that asset. The field is no longer self-editable.
  - Tests: `src/item/item-image.service.spec.ts` (4 cases). Fixtures in `src/item/item.service.spec.ts` now use realistic `items/…` public ids.

## 8. `GET /item-views/history` leaks item owners' private account fields

- **Severity:** High
- **Affected flow:** "Recently viewed" / view history
- **Endpoint / data area:** `GET /item-views/history`
- **Expected result:** Items are rendered with the public `ItemUserDto` (name, avatar, and so on).
- **Actual result:** `toResponseDto` does `Object.assign(dto, entity)` on views loaded with `item.user`. The owner's full `UserEntity` is serialized; only `password_hash` is `@Exclude`d. The response therefore includes the owner's `email`, `fcm_token`, `firebase_uid`, `date_of_birth`, `gender`, `failed_login_attempts`, `account_locked_until` and more.
- **Reproduction steps:**
  1. Signed in as any user, open another user's item (`GET /items/:id`).
  2. Call `GET /item-views/history`. `data[].item.user` contains the fields above.
- **Platform impact:** Android; privacy.
- **Evidence:** `src/item-view/item-view.service.ts:34-37,266-278`; `src/user/entities/user.entity.ts:59`
- **Confirmed by:** Repro (`instanceToPlain` output included email, fcm_token and date_of_birth).
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `ItemViewService.toResponseDto` no longer uses `Object.assign(dto, entity)`. It copies the view's own fields and renders the item through `ItemResponseDto.fromEntity`, which exposes the owner only as the public `ItemUserDto` (`src/item-view/item-view.service.ts`).
  - Tests: `src/item-view/item-view.service.spec.ts` checks that the serialized history includes the owner's name but not their email, FCM token, date of birth, firebase_uid or lockout fields.

## 9. Unblocking the same user a second time fails with 500; the block becomes permanent

- **Severity:** High
- **Affected flow:** Block / unblock user
- **Endpoint / data area:** `DELETE /moderation/users/block/:blockedId`; `blocked_users`
- **Expected result:** Block → unblock → block → unblock all succeed.
- **Actual result:** The unique index is `(blocker_id, blocked_id, is_deleted)`, and unblock soft-deletes by setting `is_deleted=true`. The second unblock would create a second `(A, B, true)` row, which violates the index (23505). The API returns 500 and the block stays active. The user can never unblock that person again.
- **Reproduction steps:**
  1. `POST /moderation/users/block {"blockedId":B}`
  2. `DELETE /moderation/users/block/B`
  3. `POST /moderation/users/block {"blockedId":B}`
  4. `DELETE /moderation/users/block/B`. The response is 500, and B is still blocked.
- **Platform impact:** Android (blocked chat), data.
- **Evidence:** `src/migrations/1767900000000-CreateModerationTables.ts:76`; `src/moderation/entities/blocked-user.entity.ts:15`; `src/moderation/moderation.service.ts:75-85`
- **Confirmed by:** Repro on the migrated schema.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - New migration `src/migrations/1791000000000-UniqueActiveBlock.ts`:
    - drops `idx_blocked_users_unique (blocker_id, blocked_id, is_deleted)`
    - adds the partial unique index `UQ_BLOCKED_USERS_ACTIVE_PAIR (blocker_id, blocked_id) WHERE is_deleted = false`
    - Result: only one *active* block per pair is enforced, and unblocked (soft-deleted) history rows may repeat.
  - The entity declares the same index, so `synchronize` in development keeps it (`src/moderation/entities/blocked-user.entity.ts`).
  - `down()` removes the surplus unblock history first (keeping the newest row per pair), then restores the old index.
  - Verified on a local Postgres built from all 29 migrations:
    - three block → unblock cycles succeed
    - a second simultaneous active block is still rejected (23505)
    - the migration reverts and re-applies cleanly
    - TypeORM's schema diff shows no index drift for this table

    **Deploy note:** production runs migrations on start (`migrationsRun`), so this applies on the next deploy.

## 10. `GET /moderation/users/blocked` leaks private fields of blocked users

- **Severity:** Medium
- **Affected flow:** Blocked users list
- **Endpoint / data area:** `GET /moderation/users/blocked`
- **Expected result:** The public user shape, the same as `toPublicUser` in item requests.
- **Actual result:** It returns the whole `blocked` `UserEntity`: email, fcm_token, firebase_uid, date_of_birth, gender, lockout fields, deletion fields. Because anyone can block any user id, anyone can read these fields for any user.
- **Reproduction steps:**
  1. `POST /moderation/users/block {"blockedId":"<any user id from GET /items>"}`
  2. `GET /moderation/users/blocked`. `data[].blocked` contains the private fields.
- **Platform impact:** Android; privacy.
- **Evidence:** `src/moderation/moderation.service.ts:87-92`; `src/user/entities/user.entity.ts:59-67`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `ModerationService.getBlockedUsers` now maps each block so that `blocked` holds only `id`, `first_name`, `last_name` and `cloudinary_avatar_url`. The field names are unchanged, so existing clients keep parsing (`src/moderation/moderation.service.ts`).
  - The block's own fields are returned as before.
  - Tests: `src/moderation/moderation.service.spec.ts`.

## 11. Deleted items can be revived and handed over through item requests

- **Severity:** Medium
- **Affected flow:** Request lifecycle vs item deletion (owner delete, or moderation `item_removed`)
- **Endpoint / data area:** `PATCH /item-requests/:id/cancel`, `/confirm`, `/pickup`, and `POST /item-requests`; `items.status` and `items.is_deleted`
- **Expected result:** Deleting an item closes its requests. A deleted item cannot be requested, confirmed or picked up.
- **Actual result:**
  - Item deletion leaves requests untouched.
  - Cancelling a confirmed request sets the item back to `available` without checking `is_deleted`.
  - `lockItem` loads the item by id only, so later requests and confirms pass their `status === available` check.
  - `confirmPickup` never checks the item.
- **Reproduction steps:**
  1. The owner confirms A's request.
  2. The owner deletes the item (`DELETE /items/:id`).
  3. A cancels. The item is now `is_deleted=true, status=available`.
  4. B requests, the owner confirms, and B completes pickup. All succeed on the deleted item.
- **Platform impact:** Android, data.
- **Evidence:** `src/item/item.service.ts:684-718`; `src/item-request/item-request.service.ts:65-68,204,321,404-410,462-484`
- **Confirmed by:** Repro on the migrated schema.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - **Deleting closes the requests.** A new helper, `closeActiveRequests` (`src/item-request/close-active-requests.ts`), cancels every pending or confirmed request with a reason, in the same transaction as the deletion. It runs when:
    - an item is deleted (owner delete, or admin/moderation `item_removed`, both via `softDeleteWithImages` in `src/item/item.service.ts`), with reason "Item was removed"
    - an account is deleted (`UserService.remove`), covering requests where the user is owner or requester, with reason "Account was deleted"

    It also removes the requester from `items.requester_ids`. It releases a reservation only on items that are *not* deleted: for example, a deleted user's confirmed request on someone else's item puts that item back to `available`.
  - **Transitions refuse deleted items** (`src/item-request/item-request.service.ts`):
    - `createRequest` and `confirmRequest` treat `is_deleted` as not available.
    - Cancelling a confirmed request no longer flips a deleted item back to `available`.
    - `confirmPickup` returns **409** "This item has been removed".
  - Account deletion now also passes only `items/…` image ids to Cloudinary, consistent with #7.
  - Verified on a local Postgres (all migrations) with the real services:
    - after confirm → delete, the request is `cancelled` ("Item was removed") and the item stays `is_deleted, unavailable`
    - a new request on it returns 400
    - pickup on a deleted item returns 409
    - deleting a requester's account releases the item they had reserved
  - Tests: `src/item-request/close-active-requests.spec.ts` (3 cases) and 2 deleted-item cases in `src/item-request/item-request.service.spec.ts`.

## 12. Owner can un-reserve via `PUT /items/:id`, allowing two confirmed requests and two pickups

- **Severity:** Medium
- **Affected flow:** Confirm / pickup state machine
- **Endpoint / data area:** `PUT /items/:id` with `status`, then `/item-requests/:id/confirm` and `/pickup`
- **Expected result:** Only one confirmed request per item; a second confirm returns 409 (`docs/ANDROID_INTEGRATION.md:377`).
- **Actual result:** `UpdateItemDto` accepts any `status`, and `update()` applies it regardless of active requests. The only guard against a second confirm is `item.status !== available`. `confirmPickup` also doesn't check whether the item was already picked up, and it overwrites `picked_by_id`.
- **Reproduction steps:**
  1. A and B both request the item.
  2. The owner confirms A.
  3. The owner sends `PUT /items/:id {"status":"available"}`.
  4. The owner confirms B.
  5. A and B both complete pickup. Both requests end `completed`, and `picked_by_id` is B.
- **Platform impact:** Android, data.
- **Evidence:** `src/item/dto/update-item.dto.ts:9-16`; `src/item/item.service.ts:604-608`; `src/item-request/item-request.service.ts:317-321,480-484`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `PUT /items/:id` now lets the owner switch status only between `available` and `unavailable`, and only while the item is in one of those two states. Anything else returns **409** (`ItemService.update` in `src/item/item.service.ts`).
  - `reserved` and `picked_up` are moved only by the request flow, which holds the item lock. To release a reservation, the owner cancels the confirmed request.
  - Echoing the current status back (clients that send the whole item) is still accepted.
  - `confirmPickup` now also requires the item to still be `reserved` and returns 409 "This item is no longer reserved" otherwise. A second pickup can't happen even if the status is changed by some other path.
  - Verified on a local Postgres with the real services: with A confirmed, the owner's `PUT {status: available}` returns 409 and confirming B returns 409. The item stays `reserved`.
  - Tests: 5 cases in `src/item/item.service.spec.ts` (4 refused transitions and 1 echo) and 1 pickup case in `src/item-request/item-request.service.spec.ts`.

## 13. Blocked users can still push item-request messages and notifications to the blocker

- **Severity:** Medium
- **Affected flow:** Block × item request
- **Endpoint / data area:** `POST /item-requests`, `PATCH /item-requests/:id/cancel|confirm|pickup`; chat system messages, FCM
- **Expected result:** If either party has blocked the other, messaging between them is refused (`docs/CHAT_MODULE.md:182-184`).
- **Actual result:** Each request transition calls `chatService.createSystemMessage`. That call persists and broadcasts the message and sends a push without calling `assertNotBlocked`. `createRequest` does no block check either.
- **Reproduction steps:**
  1. A blocks B.
  2. B sends `POST /item-requests {"item_id":"<A's item>"}`. The response is 201.
  3. A receives a "requested" chat card and a push notification from B.
- **Platform impact:** Android.
- **Evidence:** `src/item-request/item-request.service.ts:250,343,425,491`; `src/chat/chat.service.ts:1400-1448` (no block check; `assertNotBlocked` is used only at `:494,:1003`), `:908-932`
- **Confirmed by:** Trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `createRequest` now refuses (**403**, "You can no longer exchange messages with this user") when either party has blocked the other. That is the same check and wording the chat send path uses, so the refusal doesn't reveal who blocked whom (`src/item-request/item-request.service.ts`).
  - A blocked user can no longer open a request, so they can't start a thread, drop a "requested" card in the blocker's chat or push them a notification.
  - The system messages for transitions on requests that already exist are unchanged. As `ChatService.createSystemMessage` documents, they record something that already happened between the two users.
  - Tests: 2 cases (block in each direction) in `src/item-request/item-request.service.spec.ts`. Both check that nothing is saved or posted.

## 14. Socket dropped during handshake leaves user "online" forever; their chat pushes stop

- **Severity:** Medium
- **Affected flow:** Chat presence and offline push notifications
- **Endpoint / data area:** socket.io `/chat` connect/disconnect; in-memory presence in `ChatRealtimeService`
- **Expected result:** When a user's last socket closes they go offline, partners get `presence {is_online:false}`, and new messages arrive as FCM pushes.
- **Actual result:** `handleConnection` awaits JWT verification plus two DB lookups (session and user) before it sets `client.data.userId` and registers the socket. If the client disconnects during that window, `handleDisconnect` runs first, finds no `userId` and returns. `handleConnection` then registers a socket id that never disconnects. The user stays online until the process restarts. `broadcastMessage` skips FCM for online users, so that user receives no chat pushes.
- **Reproduction steps:**
  1. Connect a socket.io client to `/chat` with a valid JWT.
  2. Call `socket.disconnect()` immediately after `connect`, before the server finishes the lookups. Mobile clients hit this naturally when backgrounded mid-handshake.
  3. The server now reports `isOnline(user) === true`, and messages sent to that user produce no push.
- **Platform impact:** Android (missed notifications, wrong presence).
- **Evidence:** `src/chat/chat.gateway.ts:140-167,187-194`; `src/chat/chat-realtime.service.ts` (`registerSocket` / `isOnline`); `src/chat/chat.service.ts:213,928-930`
- **Confirmed by:** Repro (real gateway on a real socket.io server, 300 ms simulated DB latency).
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `ChatGateway.handleConnection` now checks `client.connected` after the auth lookups and immediately before `registerSocket`, with nothing awaited between the two. If the client dropped mid-handshake, the socket is not registered (`src/chat/chat.gateway.ts`).
  - A disconnect after that point sees `client.data.userId` and unregisters normally, so presence and FCM pushes stay correct.
  - Tests: `src/chat/chat.gateway.spec.ts` holds the session lookup open, disconnects, then lets it finish. It fails on the old code (the user stays online) and passes now. A second case covers the normal online → offline path.

## 15. Invalid socket payloads get no ack, only a generic "Internal server error"

- **Severity:** Medium
- **Affected flow:** Sending chat messages over the socket
- **Endpoint / data area:** socket events `message:send`, `message:read`, `typing:*`
- **Expected result:** Every event returns an ack in the REST envelope, echoing `client_message_id` (`docs/CHAT_MODULE.md`).
- **Actual result:** The gateway's `ValidationPipe` throws `BadRequestException`, which is not a `WsException`. Nest's default WS filter emits `exception {status:"error", message:"Internal server error"}` and never calls the ack. The client's optimistic bubble stays pending forever. Triggers include:
  - content over 4000 characters
  - empty content
  - a non-UUID `conversation_id`
  - any extra field
- **Reproduction steps:** On an authenticated socket, emit `message:send` with `{conversation_id:<uuid>, content:"x".repeat(4001), client_message_id:"c-1"}` and an ack callback. No ack arrives; an `exception` event with "Internal server error" arrives instead.
- **Platform impact:** Android.
- **Evidence:** `src/chat/chat.gateway.ts:65-71,246`; `src/chat/dto/ws-events.dto.ts:15-32`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - New `WsHttpExceptionFilter` (`src/chat/ws-http-exception.filter.ts`), applied to the chat gateway with `@UseFilters`. An `HttpException` thrown before a handler runs, in practice the gateway `ValidationPipe`, is now answered through the event's **ack** as `{ state: false, statusCode, message, error, client_message_id }`, with `client_message_id` echoed from the payload.
  - No generic `exception` event is emitted for these errors any more. Errors that aren't HTTP exceptions, and events sent without an ack, keep Nest's default handling.
  - Verified against a real socket.io server running the gateway with a socket.io client:
    - 4001-character content → ack `400 ["content cannot exceed 4000 characters"]`, `client_message_id: "c-1"`
    - bad `conversation_id` → ack `400 ["conversation_id must be a valid UUID"]`
    - valid send → normal 201 ack
    - no `exception` events
  - Tests: `src/chat/ws-http-exception.filter.spec.ts` (2 cases).

## 16. Error responses don't match the documented `ApiError` envelope

- **Severity:** Medium
- **Affected flow:** Error handling on all endpoints, per the Android guide
- **Endpoint / data area:** Every endpoint where validation, guards or framework errors fire (e.g. `/chat/*`, `/items`)
- **Expected result:** `docs/ANDROID_INTEGRATION.md` §5 says errors on every endpoint are `{ state: false, message, error, statusCode }`, and the Kotlin model there has non-null `state` and `error`.
- **Actual result:** There is no global exception filter. Only errors wrapped by `AppError` carry `state`. Examples:
  - Live `GET https://api.freeee.app/chat/unread-count` without a token → `{"message":"Unauthorized","statusCode":401}`.
  - Live `GET https://api.freeee.app/items?status=foo` → `{"statusCode":500,"message":"Internal server error"}`.
  - `POST /chat/conversations {"recipient_id":"x"}` → `{"message":["recipient_id must be a valid UUID"],"error":"Bad Request","statusCode":400}`. Here `message` is an array.

  With the documented model, these bodies fail to deserialize.
- **Reproduction steps:** `curl https://api.freeee.app/chat/unread-count` and compare the body with the documented `ApiError`.
- **Platform impact:** Android.
- **Evidence:** `src/main.ts:35-41`; no `APP_FILTER` / `useGlobalFilters` / `@Catch` in `src`; `src/common/app-error.ts`
- **Confirmed by:** Live and repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - New global `ApiExceptionFilter` (`src/common/filters/api-exception.filter.ts`), registered in `src/main.ts`. Every HTTP error is now `{ state: false, data: null, message, error, statusCode }`, the documented `ApiError` shape (and Swagger's `ErrorResponseDto`). That covers validation pipes, guards (401/403), unknown routes, the throttler and uncaught errors.
  - Validation errors keep `message` as an array, as the Android guide already says to expect. `AppError` bodies pass through unchanged.
  - Uncaught errors are logged and answered with a generic 500, so no internals reach the client.
  - WebSocket contexts fall back to Nest's default WS handling. The chat gateway's own filter (#15) takes precedence there.
  - Tests: `src/common/filters/api-exception.filter.spec.ts` (5 supertest cases: validation 400, guard 401, unknown route 404, AppError pass-through, uncaught 500).

## 17. Item listings show the wrong poster `items_count`

- **Severity:** Medium
- **Affected flow:** Browse items / My items (poster card)
- **Endpoint / data area:** `GET /items`, `GET /items/my-items` → `data[].user.items_count`
- **Expected result:** Each item shows its poster's actual item count.
- **Actual result:** The count is read from `raw[entities.indexOf(entity)]`. Because the query joins images, there is one raw row per image, so the indexes drift and items show another poster's count. On the live API, 16 of 42 items show a count that doesn't match their poster's item count in the same response. For example, a user with 1 item shows 30, and a user with 30 items shows 1.
- **Reproduction steps:** `GET https://api.freeee.app/items`. Group `data` by `user.id`, then compare each group's size with the `user.items_count` shown on its items.
- **Platform impact:** Android. The backoffice doesn't read this field.
- **Evidence:** `src/item/item.service.ts:397-413,454-456,476-481`
- **Confirmed by:** Live and repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `ItemService.findAll` now builds a poster id → count map from the raw rows (`item_user_id` → `user_items_count`) and looks each item up by `user_id`. It no longer reads the count from `raw[index]`, which drifted because the images join returns one raw row per image (`src/item/item.service.ts`).
  - The single-item path was already correct, since all its rows belong to one poster.
  - Verified on a local Postgres:
    - data: a 1-item poster whose item sorts after a poster with three 3-image items
    - old code: the 1-item poster shows `items_count = 3`
    - fixed code: 1, and the other poster 3
  - Tests: a new multi-image regression case in `src/item/item.service.spec.ts`. The mocks now include `item_user_id`, as real raw rows do.

## 18. Item images are returned in arbitrary order

- **Severity:** Medium
- **Affected flow:** Item cards and item detail carousel
- **Endpoint / data area:** `GET /items`, `GET /items/:id`, `GET /saved-items` → `images[]`
- **Expected result:** Images are sorted by `display_order`, so the primary image (order 0) comes first. Create/update responses do sort this way.
- **Actual result:** The listing queries never order the images. On the live API, 13 of 42 items return images out of order, often reversed (e.g. display orders `4,3,2,1,0`).
- **Reproduction steps:** `GET https://api.freeee.app/items` and inspect `images[].display_order` per item.
- **Platform impact:** Android, if it uses `images[0]` or array order. The backoffice picks `is_primary`, so it is unaffected.
- **Evidence:** `src/item/item.service.ts:400-405,455,520-535` (no image ordering) vs `:204-206` (the create path sorts); `src/saved-item/saved-item.service.ts:172-175`
- **Confirmed by:** Live.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `ItemResponseDto.fromEntity` now sorts images by `display_order`, without mutating the entity (`src/item/dto/item-response.dto.ts`).
  - Every response that renders an item through it returns the primary (order 0) image first: `GET /items`, `GET /items/:id`, my-items, saved items and view history. This matches what create and update already returned.
  - Tests: a new case in `src/item/item.service.spec.ts` (images loaded out of order come back 0, 1, 2).

## 19. Saved-items list: `is_saved:false`, deleted items and deleted images returned

- **Severity:** Medium
- **Affected flow:** Saved items
- **Endpoint / data area:** `GET /saved-items`, `POST /saved-items`
- **Expected result:** Every entry has `item.is_saved: true`. Items and images deleted by their owner or an admin are hidden, and deleted items can't be saved.
- **Actual result:**
  - `ItemResponseDto.fromEntity` is called without `isSaved`, so `is_saved` is always `false`. `user.items_count` is always 0.
  - The relations load unfiltered, so deleted items still appear, along with soft-deleted images whose Cloudinary files have already been destroyed (broken URLs).
  - `saveItem` accepts deleted items.
- **Reproduction steps:**
  1. Save an item.
  2. Have the owner remove a photo (`PUT /items/:id` with `remove_image_ids`) or delete the item.
  3. `GET /saved-items` shows `is_saved:false`, with the deleted item and deleted image still returned.
- **Platform impact:** Android.
- **Evidence:** `src/saved-item/saved-item.service.ts:39-41,54-56,167-178`; `src/item/dto/item-response.dto.ts:95`; `src/item/item.service.ts:298-300,714-716`
- **Confirmed by:** Repro and trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `GET /saved-items` changes (`src/saved-item/saved-item.service.ts`):
    - It only returns saves whose item is not deleted (`item: { is_deleted: false }`).
    - Each item is rendered with `is_saved: true`.
    - Soft-deleted images are filtered out.
    - `user.items_count` is computed with one grouped count query per page.
  - `POST /saved-items` returns 404 for a deleted item.
  - Verified on a local Postgres. A deleted saved item is hidden (total 1). The remaining item shows `is_saved: true`, only its live photo, and the owner's correct `items_count`. Saving a deleted item returns 404.
  - Tests: `src/saved-item/saved-item.service.spec.ts`.

## 20. `featured_until` is never enforced

- **Severity:** Medium
- **Affected flow:** Backoffice "Feature item" → featured listings
- **Endpoint / data area:** `POST /items/:id/feature?featured_until=`, `GET /items?is_featured=true`
- **Expected result:** An item stops being featured once `featured_until` has passed.
- **Actual result:** `featured_until` is written but never read: no filter, no scheduled job, no response logic. `is_featured=true` matches on the boolean alone.
- **Reproduction steps:**
  1. Feature an item with `featured_until` set to yesterday.
  2. `GET /items?is_featured=true`. The item is still listed, and the backoffice shows "Featured until <past date>".
- **Platform impact:** Both.
- **Evidence:** `src/item/item.service.ts:430-434,765,791` (the only references)
- **Confirmed by:** Trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - A feature now ends at `featured_until` without anything having to clear the flag (`src/item/item.service.ts`, `src/item/dto/item-response.dto.ts`):
    - The `is_featured` filter on `GET /items` requires `featured_until` to be null or in the future; `is_featured=false` returns the complement.
    - Every item response reports `is_featured: false` once `featured_until` has passed. The backoffice reads this flag from the API, so expired items drop out of "featured" there too.
  - The SQL comparison uses a bound JS date rather than `now()`. The column is `timestamp` without a time zone and is written from JS dates, so both sides serialize alike whatever the server's zone. Production's Node process runs at UTC+2, which is behind #39.
  - `POST /items/:id/feature` now rejects an invalid or past `featured_until` with 400. Before, an invalid date reached the database and failed as a 500.
  - Verified on a local Postgres with Node at UTC and at UTC+2. Items with no end date or an end date 5 minutes ahead are featured. Items that ended 5 or 90 minutes ago are not and report `is_featured: false`. A past date returns 400.
  - Tests: 5 cases in `src/item/item.service.spec.ts`.

## 21. Editing coordinates can move another user's item location

- **Severity:** Medium
- **Affected flow:** Edit item location
- **Endpoint / data area:** `PUT /items/:id` with `location_id`, then `latitude`/`longitude`; `locations`
- **Expected result:** A location edit only affects the caller's item.
- **Actual result:** `location_id` is accepted without an ownership check. A later coordinate edit updates the linked location row in place whenever that row has `user_id = null`, which is true of every location created from item coordinates. Every item's `location_id` is public in `GET /items`.
- **Reproduction steps:**
  1. Take a victim item's `location_id` from `GET /items`.
  2. `PUT /items/{mine}` with `location_id=<that id>`.
  3. `PUT /items/{mine}` with `latitude=0&longitude=0`. The victim's item now sits at 0,0 and drops out of nearby search.
- **Platform impact:** Data; Android nearby search.
- **Evidence:** `src/item/dto/create-item.dto.ts:85-88`; `src/item/item.service.ts:108-117,605-609,618-623`
- **Confirmed by:** Trace (the in-place update path is also asserted in `src/item/item.service.spec.ts:550`).
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `location_id` on `POST /items` and `PUT /items/:id` is now checked by `assertLocationUsable` (`src/item/item.service.ts`). It must be one of these, otherwise the request gets **403**:
    - the caller's own saved location
    - a temporary, ownerless location (from `POST /user/locations/temporary`) that no other live item points at
    - the item's current location, echoed back
  - `resolveCoordinates` now edits a throwaway location row in place only if no *other* live item points at it; otherwise it creates a fresh row. Rows shared before this fix can't be used to move someone else's item either.
  - Verified on a local Postgres with the real service. The attacker's `PUT location_id=<victim's>` returns 403 and the victim's coordinates are unchanged. Creating an item with a fresh temporary location still works.
  - Tests: 3 cases in `src/item/item.service.spec.ts` (another user's saved location, a temporary location used elsewhere, a shared row not edited).

## 22. Wrong code on verify-email / reset-password returns 500 instead of 400

- **Severity:** Medium
- **Affected flow:** Email verification; password reset
- **Endpoint / data area:** `POST /auth/verify-email`, `POST /auth/reset-password`
- **Expected result:** 400 "Invalid verification code" / "Invalid reset code".
- **Actual result:** On a mismatch the code commits the transaction and then throws `BadRequestException`. The `catch` block calls `rollbackTransaction()` on the already-committed runner, which throws `TransactionNotStartedError` and replaces the 400. The client gets 500.
- **Reproduction steps:** `POST /auth/verify-email {"email":"<registered>","code":"000000"}`. The response is 500. The same happens for `/auth/reset-password` with a wrong code.
- **Platform impact:** Android (the app can't tell the user the code is wrong).
- **Evidence:** `src/auth/auth.service.ts:246-250` → `:269-270`; `:806-810` → `:829-830`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - The `catch` blocks in `src/auth/auth.service.ts` now roll back only `if (queryRunner.isTransactionActive)`, the idiom `login` already used.
  - A wrong code still commits its `attempt_count` and then throws the intended **400** ("Invalid verification code" / "Invalid reset code"). Before, the rollback of the already-committed transaction threw `TransactionNotStartedError`, and that replaced the 400.
  - The same guard was applied to the other four rollbacks in the file.
  - Verified on a local Postgres:
    - old code: `TransactionNotStartedError` for both endpoints
    - fixed code: `BadRequestException 400` for both, with `attempt_count = 1` persisted
  - Tests: 2 cases in `src/auth/auth.service.spec.ts`. They fail on the old code.

## 23. Changing email/phone to one already in use returns 500 with raw DB error

- **Severity:** Medium
- **Affected flow:** Edit profile
- **Endpoint / data area:** `PATCH /user/:id`
- **Expected result:** 409 Conflict with a readable message.
- **Actual result:** There is no uniqueness pre-check. The response is `500 {"message":"duplicate key value violates unique constraint \"UQ_97672ac88f789774dd47f7c8be3\"","error":"QueryFailedError"}`. Phone numbers behave the same way.
- **Reproduction steps:** `PATCH /user/<me> {"email":"<another user's email>"}`
- **Platform impact:** Android, backoffice.
- **Evidence:** `src/user/user.service.ts:556,588`; `src/common/app-error.ts:33-35`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `UserService.update` now checks whether a changed email or phone already belongs to another account, and answers **409** "Email already exists" / "Phone number already exists" (`src/user/user.service.ts`).
  - If a concurrent update claims the value between the check and the write, the unique violation (23505) is mapped to 409 as well. The raw constraint name no longer reaches the client.
  - Verified on a local Postgres: changing A's email or phone to B's returns `409 {"state":false,…,"message":"Email already exists","error":"Conflict"}`.
  - Tests: 2 cases in `src/user/user.service.spec.ts`.

## 24. Other pending requests stay pending forever after pickup

- **Severity:** Low
- **Affected flow:** Pickup completion
- **Endpoint / data area:** `PATCH /item-requests/:id/pickup`; `/item-requests/my-requests`; chat item context
- **Expected result:** Once the item is picked up, the other requests are closed (`EXPIRED` exists but is never set).
- **Actual result:** Only the winning request is updated. The others stay `pending`, can never be confirmed (409), and chat shows them as `is_pending_pickup=true`.
- **Reproduction steps:**
  1. A and B request the item.
  2. The owner confirms A, and A completes pickup.
  3. B's request is still `pending`, and confirming it returns 409.
- **Platform impact:** Android.
- **Evidence:** `src/item-request/item-request.service.ts:474-486`; `src/chat/chat.service.ts:395-399`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `confirmPickup` now closes every other pending request on the item in the same transaction, via `closeActiveRequests` (#11). Those requests become `cancelled` with reason "Item was picked up by another requester", and their requesters leave `requester_ids` (`src/item-request/item-request.service.ts`).
  - `cancelled` is used rather than the never-used `expired` value, because it's the status clients already handle.
  - Chat's `is_pending_pickup` follows from the request status, so it now clears too.
  - Verified on a local Postgres with three requesters: A completes, and B and C become `cancelled` with that reason.
  - Tests: a new `confirmPickup` case in `src/item-request/item-request.service.spec.ts`.

## 25. Moderation queue sorts priority alphabetically

- **Severity:** Low
- **Affected flow:** Backoffice report queues
- **Endpoint / data area:** `GET /moderation/items/reports`, `GET /moderation/users/reports`
- **Expected result:** urgent → high → medium → low.
- **Actual result:** `order: { priority: 'DESC' }` on a varchar column gives urgent → medium → low → high.
- **Reproduction steps:** Create reports with each priority, then list them. `high` comes last.
- **Platform impact:** Backoffice.
- **Evidence:** `src/moderation/moderation.service.ts:166,181`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `getItemReports` and `getUserReports` now load newest first and then rank priorities explicitly: urgent → high → medium → low. The sort is stable, so newest-first order is kept within each priority (`byPriority` in `src/moderation/moderation.service.ts`).
  - The lists aren't paginated, so ranking in memory is exact. Sorting the varchar in SQL had been alphabetical.
  - Tests: 2 cases in `src/moderation/moderation.service.spec.ts`.

## 26. Resolving a second report with `item_removed` returns 404; report stays pending

- **Severity:** Low
- **Affected flow:** Resolve item report
- **Endpoint / data area:** `PATCH /moderation/items/report/:id/resolve` (`actionTaken: item_removed`)
- **Expected result:** The report is resolved, even though the item is already removed.
- **Actual result:** `adminRemove` looks the item up with `is_deleted:false` and throws 404 before the report is saved. The report stays in the queue and can't be resolved with that action.
- **Reproduction steps:**
  1. Two users report the same item.
  2. Resolve the first report with `item_removed`, then the second with `item_removed`. The second returns 404 and stays `pending`.
- **Platform impact:** Backoffice.
- **Evidence:** `src/item/item.service.ts:728-735`; `src/moderation/moderation.service.ts:113-121`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `resolveItemReport` with `actionTaken: item_removed` now treats a 404 from `adminRemove` as "already removed" and resolves the report anyway. Reports reference items by foreign key, so the item exists; `adminRemove` only finds live items (`src/moderation/moderation.service.ts`).
  - Any other error still propagates.
  - Tests: 1 case in `src/moderation/moderation.service.spec.ts`.

## 27. Audit log mislabels moderation actions and skips item requests / complaints

- **Severity:** Low
- **Affected flow:** Backoffice audit log
- **Endpoint / data area:** `audit_logs` (written by the audit interceptor), backoffice `/audit`
- **Expected result:** Every mutation is logged against the right entity.
- **Actual result:** Entity detection uses URL substrings:
  - `PATCH /moderation/items/report/{reportId}/resolve` is logged as entity `items/{reportId}`.
  - The user-report equivalent is logged as `users/{reportId}`.
  - `/moderation/complaints/*` and every `/item-requests/*` mutation are not logged at all.
- **Reproduction steps:** Resolve an item report, then check `GET /audit`. The entry has type `items` and the report's id. Create an item request; no audit row is written.
- **Platform impact:** Backoffice, data.
- **Evidence:** `src/audit/interceptors/audit.interceptor.ts:115-136`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `AuditInterceptor.extractEntityInfo` now matches the request **path** against an ordered route table on whole segments, most specific first, instead of `url.includes(...)` (`AUDITED_ROUTES` in `src/audit/interceptors/audit.interceptor.ts`). Moderation actions are now logged against their own entities:
    - `reported_items` / `reported_users` for reports and their resolutions, with the report's id
    - `blocked_users`
    - `moderation_complaints`
  - Item requests (`item_requests`, id from `:requestId`) and item images (`item_images`) are now logged; before, neither path matched.
  - Ids not in the path still come from the response, as before.
  - Tests: `src/audit/interceptors/audit.interceptor.spec.ts` covers 12 routes, plus 3 paths that must not be guessed.

## 28. `POST /item-views` ignores the logged-in user; views double-counted

- **Severity:** Low
- **Affected flow:** Item view tracking
- **Endpoint / data area:** `POST /item-views`; `items.view_count`
- **Expected result:** An authenticated view is recorded under the viewer and deduplicated with the view `GET /items/:id` already records.
- **Actual result:** The route has no guard (not even the optional one), so `req.user` is always undefined and every call records an anonymous per-IP view. `GET /items/:id` records a separate viewer view, and each type has its own unique index, so one user's open counts +2. POST-recorded views also never appear in history.
- **Reproduction steps:** As user U, `GET /items/X`, then `POST /item-views {"item_id":"X"}` with the bearer token. `view_count` rises by 2.
- **Platform impact:** Android, data.
- **Evidence:** `src/item-view/item-view.controller.ts:34-67`; `src/item-view/item-view.service.ts:60,81`; `src/item/item.service.ts:551-555`; `src/migrations/1784000000000-DedupeItemViews.ts`
- **Confirmed by:** Trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `POST /item-views` now uses `OptionalJwtAuthGuard` (`src/item-view/item-view.controller.ts`). With a bearer token, `req.user` is populated and the view is recorded under the viewer. It then dedupes against the view `GET /items/:id` already recorded, through the existing per-viewer unique index, and appears in the viewer's history. Anonymous calls work as before.
  - Verified on a local Postgres: `GET /items/:id`'s view, followed by `POST /item-views` as the same user, returns "View already recorded". `view_count` stays 1 and history has 1 entry.
  - Tests: `src/item-view/item-view.controller.spec.ts` checks the guard is applied.

## 29. Re-creating a deleted category's slug returns 500

- **Severity:** Low
- **Affected flow:** Backoffice category management
- **Endpoint / data area:** `POST /categories`, `PUT /categories/:id`
- **Expected result:** 201/200, or 409 if the slug truly can't be reused.
- **Actual result:** The duplicate check ignores soft-deleted rows, but the DB `UNIQUE("slug")` constraint covers all rows, so the insert fails with 500.
- **Reproduction steps:** `DELETE /categories/{id}` (slug `garage`), then `POST /categories {"name":"Garage","slug":"garage"}`. The response is 500.
- **Platform impact:** Backoffice.
- **Evidence:** `src/category/category.service.ts:29-37,172-181`; `src/migrations/1767860392658-CreateCategoriesAndItemImages.ts:11`
- **Confirmed by:** Trace and the migration.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - Create and rename now go through `claimSlug` (`src/category/category.service.ts`). A live category holding the slug is still a **409**. A soft-deleted holder gives the slug up by moving to `<slug>~<its id>`, which fits the 100-character column, so the slug can be reused. This also works for categories deleted before the fix.
  - Verified on a local Postgres. Delete `garage`, then create `garage` again: 201, and the deleted row now holds `garage…~<uuid>`. A live duplicate still returns 409.
  - Tests: 2 cases in `src/category/category.service.spec.ts`.

## 30. Category parent cycles make both categories vanish

- **Severity:** Low
- **Affected flow:** Backoffice category management → category list in the app
- **Endpoint / data area:** `PUT /categories/:id` (`parent_id`), `GET /categories`
- **Expected result:** A cycle is rejected.
- **Actual result:** Only direct self-parenting is blocked. Setting A.parent=B and then B.parent=A succeeds. Neither is top-level any more, so both disappear from `GET /categories`.
- **Reproduction steps:**
  1. `PUT /categories/A {"parent_id":B}`
  2. `PUT /categories/B {"parent_id":A}`
  3. `GET /categories`. A and B are missing.
- **Platform impact:** Both.
- **Evidence:** `src/category/category.service.ts:86,185-200`
- **Confirmed by:** Trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `PUT /categories/:id` now walks up from the requested parent, and refuses (**400**) a parent that is the category itself or any of its descendants (`assertNotDescendant` in `src/category/category.service.ts`).
  - Verified on a local Postgres with A → B → C: moving A under B, or under grandchild C, both return 400.
  - Tests: 1 case in `src/category/category.service.spec.ts`.

## 31. Deleted/inactive categories still returned via category detail and items

- **Severity:** Low
- **Affected flow:** Category browsing, item detail
- **Endpoint / data area:** `GET /categories/:id`, `GET /categories/slug/:slug`, `GET /items`, `GET /items/:id`
- **Expected result:** Deleted and inactive subcategories aren't returned, and items don't embed a deleted category.
- **Actual result:** `findOne` / `findBySlug` load `subcategories` unfiltered. Item queries join `item.category` without an `is_deleted` condition.
- **Reproduction steps:** Delete a subcategory, then `GET /categories/{parentId}`. The deleted child is still listed.
- **Platform impact:** Both.
- **Evidence:** `src/category/category.service.ts:116-119,139-142`; `src/category/dto/category-response.dto.ts:53-56`; `src/item/item.service.ts:399,519`
- **Confirmed by:** Trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `GET /categories/:id` and `GET /categories/slug/:slug` now return only live, active subcategories, the same set the public list shows (`src/category/category.service.ts`). These detail endpoints are used by the app only; the backoffice uses the list with `active_only=false`.
  - Item queries now join `item.category` only when it isn't deleted (`findAll` and `findOne` in `src/item/item.service.ts`). An item in a deleted category keeps its `category_id` but no longer embeds the deleted category.
  - Verified on a local Postgres: after deleting subcategory D, `GET /categories/A` lists only B, and an item in D returns `category: null`.
  - Tests: 1 case in `src/category/category.service.spec.ts`.

## 32. `is_free` defaults to true even when a price is set

- **Severity:** Low
- **Affected flow:** Post / edit item
- **Endpoint / data area:** `POST /items`, `PUT /items/:id`; `items.is_free`, `items.price`
- **Expected result:** An item with `price > 0` is not free, or the request is rejected.
- **Actual result:** The free-vs-price check runs only when `is_free` is sent as `true`. If it is omitted, the DB default `true` is stored alongside the price.
- **Reproduction steps:** `POST /items` with `price=50` and no `is_free`. The item is stored as `is_free:true, price:50` and appears under `GET /items?is_free=true`.
- **Platform impact:** Both.
- **Evidence:** `src/item/item.service.ts:336-349,592-613`; `src/item/entities/item.entity.ts:98`
- **Confirmed by:** Trace.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `POST /items` now sets `is_free` explicitly. If `is_free` isn't sent, it is derived from the price (free unless `price > 0`) instead of falling back to the column's `true` default (`src/item/item.service.ts`).
  - On `PUT /items/:id`, sending a positive `price` without `is_free` now makes the item not free.
  - Sending `is_free: true` with a price is still a 400, and `is_free: true` still zeroes the price.
  - Tests: 3 cases in `src/item/item.service.spec.ts`.

## 33. `items.category_id` has no foreign key

- **Severity:** Low
- **Affected flow:** Post / edit item with a category; category deletion
- **Endpoint / data area:** `POST /items`, `PUT /items/:id`; `items.category_id`
- **Expected result:** An unknown `category_id` is rejected, and deleting a category nulls it on its items (the entity declares `onDelete: 'SET NULL'`).
- **Actual result:** No migration creates the FK, and the service doesn't check the category exists. Any UUID is stored and left dangling. TypeORM's schema diff against the migrated DB wants to add `FK_0c4aa809…`. Production may differ only if it was ever synchronized; that was not checked.
- **Reproduction steps:** `POST /items` with `category_id=00000000-0000-4000-8000-000000000000`. The response is 201, and the item has a `category_id` but no `category`.
- **Platform impact:** Data; both clients.
- **Evidence:** `src/item/entities/item.entity.ts:76-80`; `src/migrations/1767859975942-CreateItemsTable.ts:30-67`; `src/item/item.service.ts:346-350`
- **Confirmed by:** Migration run and schema diff.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - New migration `src/migrations/1792000000000-AddItemsCategoryForeignKey.ts`:
    - first clears dangling `items.category_id` values
    - then adds `FK_0c4aa809ddf5b0c6ca45d8a8e80 (category_id) REFERENCES categories(id) ON DELETE SET NULL`, the constraint and name the entity declares
    - is idempotent: skipped if an equivalent FK already exists (e.g. on a database that was once synchronized)
  - `POST /items` and `PUT /items/:id` now answer an unknown or deleted `category_id` with **400** instead of storing it (`assertCategoryUsable` in `src/item/item.service.ts`).
  - Verified on a local Postgres:
    - a planted dangling value is cleared by the migration
    - the API returns 400 for an unknown category
    - a raw insert is rejected by the FK (23503)
    - hard-deleting a category sets its items' `category_id` to NULL
    - the migration reverts and re-applies cleanly, and TypeORM's schema diff no longer asks for this FK

    **Deploy note:** it runs on the next deploy (`migrationsRun`).
  - Tests: 1 case in `src/item/item.service.spec.ts`.

## 34. Chat history pagination skips messages in the cursor's millisecond

- **Severity:** Low
- **Affected flow:** Scrolling back through a chat thread
- **Endpoint / data area:** `GET /chat/conversations/:id/messages?before=<messageId>`
- **Expected result:** Every message older than the cursor is returned.
- **Actual result:** `created_at` is stored with microsecond precision. The cursor's timestamp is read back into a JS `Date`, which keeps only milliseconds, and then used in `(created_at, id) < (cursor, id)`. Older messages that fall in the same millisecond as the cursor are skipped. If that page comes back short, the client treats it as the start of the thread and never loads those messages.
- **Reproduction steps:** Two messages at `10:00:00.123100` and `10:00:00.123400`. `limit=1` returns the newer one. `before=<newer.id>&limit=1` then returns `[]` instead of the older one.
- **Platform impact:** Android.
- **Evidence:** `src/chat/chat.service.ts:803-822`; `src/migrations/1788000000000-CreateChatTables.ts:80`
- **Confirmed by:** Repro on the migrated schema.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - The `before` cursor is now compared against the cursor row inside SQL, `(created_at, id) < (SELECT c.created_at, c.id FROM chat_messages c WHERE c.id = :cursorId)`, so the microsecond timestamp never goes through a millisecond JS `Date` (`getMessages` in `src/chat/chat.service.ts`).
  - The check that the cursor belongs to the conversation is unchanged.
  - Verified on a local Postgres with two messages 0.3 ms apart in the same millisecond. `before=<newer>`:
    - old code: returned `[]`
    - fixed code: returns `["older"]`
  - There is no unit test, because the behavior lives in SQL and a mocked test would only restate the query string. This is covered by the database check above.

## 35. Malformed ids/enums on public item/category/view endpoints return 500

- **Severity:** Low
- **Affected flow:** Browse / filter items, category detail, item stats
- **Endpoint / data area:** `GET /items?status=|category_id=|user_id=`, `GET /categories/:id`, `GET /item-views/stats/:id?days=`
- **Expected result:** 400.
- **Actual result:** The raw values reach Postgres and the API returns 500. `?days=abc` also leaks the SQL error text in the body.
- **Reproduction steps (live):**
  - `GET https://api.freeee.app/items?status=foo` → 500
  - `GET https://api.freeee.app/items?category_id=abc` → 500
  - `GET https://api.freeee.app/categories/abc` → 500
  - `GET /item-views/stats/<id>?days=abc` → 500 with `invalid input syntax for type timestamp`
- **Platform impact:** Both.
- **Evidence:** `src/item/item.controller.ts:213-215,249-252`; `src/category/category.controller.ts:168-171`; `src/item-view/item-view.controller.ts:124-127`; `src/item-view/item-view.service.ts:162-163`
- **Confirmed by:** Live.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - Malformed input on these public endpoints now returns **400** in the standard envelope before any query runs:
    - `GET /items`: `user_id` and `category_id` through `ParseUUIDPipe({ optional: true })`, `status` through `ParseEnumPipe(ItemStatus)`
    - `GET /items/:id` and `GET /categories/:id`: `ParseUUIDPipe`
    - `GET /item-views/stats/:itemId`: the id through `ParseUUIDPipe`, and `days` through `ParseIntPipe`, limited to 1–365
  - `AppError` no longer copies the message or name of a non-HTTP error into the response. The client gets "Internal server error", and the service has already logged the original. SQL text such as `invalid input syntax for type timestamp` can't leak any more (`src/common/app-error.ts`).
  - Tests: `src/common/filters/bad-input.e2e.spec.ts`, a supertest suite through the real controllers and pipes:
    - 7 malformed requests return 400 and never reach the service
    - valid filters still return 200
    - `AppError` doesn't leak an unexpected error's text

## 36. Item-request pagination and reports on missing targets return 500

- **Severity:** Low
- **Affected flow:** My requests / received requests; reporting and blocking
- **Endpoint / data area:** `GET /item-requests/my-requests|received?page=`; `POST /moderation/items/report`, `POST /moderation/users/report`, `POST /moderation/users/block`
- **Expected result:** 400 for a bad page; 404 for a missing item or user.
- **Actual result:**
  - `page=0`, a negative page, or `page=abc` → 500 ("OFFSET must not be negative" / "skip is not a number").
  - Reporting a nonexistent item id → FK violation 23503 → 500. The user report and block endpoints behave the same for nonexistent user ids.
- **Reproduction steps:**
  - `GET /item-requests/my-requests?page=0` → 500
  - `POST /moderation/items/report {"itemId":"<random uuid>","reason":"..."}` → 500
- **Platform impact:** Android.
- **Evidence:** `src/item-request/item-request.controller.ts:220-229`; `src/item-request/item-request.service.ts:525,584`; `src/moderation/moderation.service.ts:40-47`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `GET /item-requests/my-requests` and `GET /item-requests/received` now parse `page` and `limit` with `DefaultValuePipe` + `ParseIntPipe`, and require `page ≥ 1` and `1 ≤ limit ≤ 100`. Anything else is a **400**, not a 500 from `OFFSET` (`src/item-request/item-request.controller.ts`).
  - `reportItem`, `reportUser` and `blockUser` map the foreign-key violation (23503) for an id that doesn't exist to **404** "Item not found" / "User not found" (`saveOr404` in `src/moderation/moderation.service.ts`).
  - Verified on a local Postgres: reporting a missing item or user, or blocking a missing user, each returns 404.
  - Tests:
    - `src/item-request/item-request.controller.spec.ts`: supertest, 5 bad paging requests return 400 and the defaults are 1 and 20
    - 2 cases in `src/moderation/moderation.service.spec.ts`

## 37. Preference endpoints skip body validation; bad input returns 500

- **Severity:** Low
- **Affected flow:** Onboarding preferred categories; language and theme settings
- **Endpoint / data area:** `PATCH /user/preferences/categories`, and the language and theme preference endpoints
- **Expected result:** 400 when `category_ids` is missing or not UUIDs; `IsIn` / `MaxLength` enforced on language and theme.
- **Actual result:** `@Body('category_ids') string[]` has metatype `Array`, so `ValidationPipe` skips it. The language and theme endpoints use `@Body('<field>')` the same way.
  - Missing `category_ids` → TypeError → 500.
  - `["abc"]` → invalid uuid → 500.
  - Language and theme accept any value.
- **Reproduction steps:** `PATCH /user/preferences/categories {}` → 500; `{"category_ids":["abc"]}` → 500.
- **Platform impact:** Android.
- **Evidence:** `src/user/user-preference.controller.ts:205-209,304-308,356-360`; `src/user/user-preference.service.ts:164-165`
- **Confirmed by:** Repro.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `PATCH /user/preferences/categories`, `/language` and `/theme` now bind real body DTOs instead of `@Body('field')`, so the global `ValidationPipe` checks them (`src/user/dto/preference-fields.dto.ts`, `src/user/user-preference.controller.ts`).
    - `category_ids` must be an array of UUIDs.
    - `language` must be a non-empty string of at most 10 characters.
    - `theme` must be one of `light`, `dark` or `auto`.
  - Bad input is a **400** before the service runs. Request bodies keep the same shape.
  - Tests: `src/user/user-preference.controller.spec.ts`, a supertest suite: 6 bad bodies return 400, and valid values pass through.

## 38. Audit log filters with a non-UUID return 500

- **Severity:** Low
- **Affected flow:** Backoffice audit log filtering
- **Endpoint / data area:** `GET /audit?userId=`, `GET /audit/entity/:entityType/:entityId`
- **Expected result:** 400, or an empty result.
- **Actual result:** The DTO only checks `IsString`, and the value is compared against uuid columns, so Postgres errors and the API returns 500. The backoffice "User ID" box sends a debounced request as you type, so a partly typed id breaks the table.
- **Reproduction steps:** `GET /audit?userId=1111` (as admin) → 500.
- **Platform impact:** Backoffice.
- **Evidence:** `src/audit/dto/audit-log-query.dto.ts:6-19`; `src/audit/audit.service.ts:104-118,160-168`; `free-backoffice/src/app/(admin)/audit/page.tsx:27-37`
- **Confirmed by:** Repro on the migrated schema.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `AuditService.findAll` returns `{ logs: [], total: 0 }` when `userId` or `entityId` isn't a UUID, and `getEntityHistory` returns `[]` in the same case. The query isn't run, so Postgres never sees the value (`src/audit/audit.service.ts`).
  - No row can match a non-UUID in a uuid column, so the empty result is exact. It suits the backoffice's filter-as-you-type box, which shows query errors in the table; a 400 would still break the table while an id is half typed.
  - Verified on a local Postgres: `userId=1111` returns an empty result instead of `invalid input syntax for type uuid`.
  - Tests: `src/audit/audit.service.spec.ts` (3 cases).

## 39. View stats dates shifted a day for UTC clients

- **Severity:** Low
- **Affected flow:** Item view statistics
- **Endpoint / data area:** `GET /item-views/stats/:id` → `views_by_date[].date`
- **Expected result:** Calendar dates such as `"2026-09-23"`.
- **Actual result:** The Postgres `DATE` is parsed by node-pg as local midnight on the server (UTC+2) and serialized as `"2026-09-22T22:00:00.000Z"`. A client in Ghana (UTC+0) shows the previous day.
- **Reproduction steps:** `GET https://api.freeee.app/item-views/stats/<item id>` and inspect `views_by_date[].date`.
- **Platform impact:** Android, backoffice.
- **Evidence:** `src/item-view/item-view.service.ts:210-235`
- **Confirmed by:** Live.
- **Status:** Fixed on branch `fix/backend-issues`
- **How it was fixed:**
  - `views_by_date[].date` is now formatted in SQL as `TO_CHAR(DATE(created_at), 'YYYY-MM-DD')`, a plain calendar date string (`getItemViewStats` in `src/item-view/item-view.service.ts`). Before, node-pg parsed the `DATE` as midnight in the server's zone and serialized it as the previous day's 22:00Z.
  - Verified on a local Postgres with Node at UTC+2, as in production, for a view recorded on 2026-09-25:
    - old code: `"2026-09-24T22:00:00.000Z"`, reproducing the live output
    - fixed code: `"2026-09-25"`
  - There is no unit test, because the behavior is the database driver's date parsing. It is covered by the database check above.

---

### Confirmed but not logged (no product impact found)

- The cache module returns `{store}`, which `@nestjs/cache-manager` v3 ignores. The Upstash/Redis store is never used and the cache is in-memory. TTLs are milliseconds, so the one-hour user cache lasts 3.6 s. This affects performance and intent only; no wrong data was found (`src/app.module.ts:47-98`).
