# Back office build plan

As of 2026-09-25. Covers the backend (`free-backend`) and the back office (`free-backoffice`, Next.js).

## Status

Updated as each piece lands. ✅ done · 🚧 in progress · ⬜ not started.

| Phase | Item | Status | Notes |
| --- | --- | --- | --- |
| 0 | `MODERATOR` role + migration | ✅ | `1793000000000-AddModeratorRole` (`ALTER TYPE … ADD VALUE`, no table rewrite); `STAFF_ROLES` / `isStaff()` in `user.entity.ts`. Not yet run against a database |
| 0 | Moderators on existing staff endpoints | ✅ | User list/detail, all-locations, report and complaint queues + resolve. Staff accounts can't be suspended from a report; `item_removed` is admin only; nobody reviews a report they filed. `src/auth/roles-matrix.spec.ts` pins every `@Roles` handler |
| 0 | `AdminModule` + `AdminAuditService` | ✅ | `src/admin/`; every admin write records actor, role, old/new values, reason |
| 0 | `PATCH /admin/users/:id/role` | ✅ | Admin only; ends the user's sessions; can't change your own role. The only way to change a role: `PATCH /user/:id` now rejects `role` |
| 0 | Back office: moderator login, role in session, admin-only actions hidden | ✅ | `bo_staff` cookie → `useStaff()` / `useIsAdmin()`, renewed with each token refresh; if missing, looked up via `/auth/me`, else shown as moderator. Admin only: role changes, deactivate, feature/remove listings, category edits, Settings, Notifications |
| 0 | Back office: V1 sidebar + placeholders | ✅ | Items → `/listings`, moderation queues → `/reports/*`, complaints → `/support`, audit → `/settings/audit`; old URLs redirect. Requests, Give-aways, Locations, Notifications are placeholders |
| 1 | Account status + listing moderation columns | ✅ | `1794000000000-AddAccountAndListingModeration`: `users.account_status` (active/suspended/banned), `status_reason`, `suspended_until`, `status_changed_by/at`; `items.moderation_status` (visible/hidden/flagged), `moderation_reason`, `moderated_by/at`. Existing deactivated users become `suspended`. Not yet run against a database |
| 1 | Suspend / ban / reinstate | ✅ | `POST /admin/users/:id/{suspend,ban,reinstate}`. Suspend (staff) keeps sessions so the user can appeal; optional `until`, lifted by a 10-minute cron. Ban (admin) ends sessions, revokes Firebase tokens, and `JwtAuthGuard` refuses banned accounts everywhere. Only admins lift a ban. Staff accounts can't be suspended or banned. Legacy `is_active` writes keep `account_status` in step |
| 1 | Admin user list + detail | ✅ | `GET /admin/users` (search, status, role, joined range), `/:id` (counts), `/:id/{requests,reports,activity}`. Curated response shape: no tokens |
| 1 | Hide / flag / restore listings | ✅ | `POST /admin/items/:id/{hide,flag,restore}` (staff). Hidden listings leave `GET /items`, `GET /items/:id` (404) and saved items; the owner still sees them with `is_hidden` + `hidden_reason`. New requests and confirmations on hidden listings are refused |
| 1 | Admin listing list + detail | ✅ | `GET /admin/items` (search, sharer, category incl. subcategories, status, moderation, city/area, has-requests, include removed), `/:id` with requests in order, selected one marked, and reports |
| 1 | Back office: Users + Listings | ✅ | Users list with search/filters → user page (header, counts, Listings / Requests / Reports / Activity tabs, suspend/ban/reinstate/role). Listings list with filters → listing page (sharer, photos, ordered requests, reports, hide/flag/restore, feature/remove for admins). Report rows link to both |
| 2 | Reports and moderation | ⬜ | |
| 3 | Requests and Give-aways | ⬜ | |
| 4 | Dashboard and Locations | ⬜ | |
| 5 | Categories and Support | ⬜ | |
| 6 | Notifications | ⬜ | |

## Where things stand

The back office sends every call through `/api/backend/*` to this API. It already covers moderation queues, items, categories, users and the audit log. The backend has almost none of the admin surface the spec needs. What it does have is the right raw data, so most of the work is admin endpoints and aggregate queries, not new domain models.

- **Roles.** Only `USER` and `ADMIN` exist (`src/user/entities/user.entity.ts`). The back office login rejects anyone who isn't `ADMIN`.
- **Suspend and ban.** The only account control is the `is_active` flag, set through `PATCH /user/:id`. There's no difference between suspended and banned, no reason or end date, and sessions aren't revoked.
- **Hiding listings.** The only way to take a listing down is soft delete (`is_deleted`), so there's no reversible hide or flag.
- **Requests.** Statuses are `pending / confirmed / cancelled / completed / expired`. "Selected" means `confirmed`, and the request order is `created_at`. Nothing records status history. As far as I can see nothing ever sets `expired`: no cron job does it.
- **Pickup confirmation is one-sided.** The owner confirms a request, then the requester confirms pickup with a code. The spec's separate "Sharer confirmed" and "Requester confirmed" stages don't exist.
- **Reports.** Statuses are `pending / resolved / dismissed`, with one `resolution_notes` field. There's no "Reviewing" status, no notes history and no assignee.
- **Categories.** `display_order` exists but there's no endpoint to reorder.
- **Locations.** `region / city / area` exist on locations, and listings reference `location_id`. That's enough for per-area totals.
- **Push.** `FirebaseService.sendNotification` sends to one token only. Each user has a single `fcm_token`.
- **Support.** The complaints table (type, reference, subject, status, admin response) is a workable starting point.
- **PostHog.** The backend doesn't use it, so the back office will only link out to it.

## How to build it

- **Put all admin endpoints under `/admin/*`** in a new `AdminModule`. Split it into one controller per area: `AdminUsersController`, `AdminItemsController`, and so on. Each is guarded by `JwtAuthGuard + RolesGuard` with `@Roles(ADMIN, MODERATOR)` by default, and `ADMIN` only where noted. This stops admin logic leaking into the app-facing endpoints, and those endpoints stay as they are.
- **Every admin write goes through one helper** that writes an audit log entry with the actor, old and new values, and a reason. That covers the activity-log requirement, and the Audit page can then filter to admin actors.
- **Aggregations are plain SQL** in the services, cached for about 60s in Redis, which is already a dependency. No separate stats pipeline.

## Phases

### Phase 0: Foundations

Everything else depends on this.

**Backend**

- Add `MODERATOR` to `UserRole` (migration).
- Define the permission matrix:
  - Moderator: view users, listings, requests and reports; act on reports; hide or restore listings; suspend users.
  - Admin only: permanent bans, categories, notifications, role changes, settings (including the audit log), featuring and removing listings outright.
- Create `AdminModule` with the audit helper.
- `PATCH /admin/users/:id/role` (admin only).

**Back office**

- Accept `MODERATOR` at login.
- Expose the role in the session and hide actions the role can't use.
- Restructure the sidebar to the V1 layout (Dashboard, Users, Listings, Requests, Give-aways, Reports, Categories, Locations, Notifications, Support, Settings), with "Coming soon" placeholders for areas not built yet.

### Phase 1: Enforcement (Users and Listings)

**Backend**

- User migration: add `account_status` (`active | suspended | banned`), `status_reason`, `suspended_until`, `status_changed_by`. Keep `is_active` in sync, or derive it, so the existing guards keep working.
- `POST /admin/users/:id/suspend` `{reason, until?}`, `/ban` (admin only), `/reinstate`. Suspending or banning revokes sessions and Firebase tokens.
- `GET /admin/users` with search (name, email, phone) and filters (status, role, created range).
- `GET /admin/users/:id`: profile plus counts (listings, requests made and received, reports against them, completed give-aways).
- `GET /admin/users/:id/{items,requests,reports,activity}`. Activity comes from `user_activity_log` and the audit log.
- Item migration: add `moderation_status` (`visible | hidden | flagged`), `moderation_reason`, `moderated_by`, `moderated_at`. Public item queries and search must exclude `hidden`.
- `GET /admin/items` with filters (search, category, city/area, status, moderation status, has-requests).
- `GET /admin/items/:id`: listing detail with the sharer and its requests.
- `POST /admin/items/:id/hide`, `/restore`, `/flag`.

**Back office**

- Users list, then a user detail page with tabs: Profile · Listings · Requests · Activity · Reports. Status actions are confirm dialogs that require a reason.
- Listings list with filters, then a listing detail page (Sharer card, Requests table, Hide/Restore/Flag).

### Phase 2: Reports and moderation

**Backend**

- Add `reviewing` to the report status enums.
- Add a `moderation_notes` table (`report_type, report_id, author_id, body, created_at`) so notes build up as a history.
- `GET /admin/reports`: one feed across item and user reports, filtered by type, status and date.
- `PATCH /admin/reports/:type/:id/status`.
- `POST /admin/reports/:type/:id/notes`.
- `POST /admin/reports/:type/:id/action` `{action: hide_listing | suspend_user | ban_user | warn, ...}`. This calls the Phase 1 services and resolves the report in the same transaction.

**Back office**

- Merge the three moderation pages into one Reports page: tabs by type, a status filter and a detail drawer (reporter, target, reason, notes history, Take action / Dismiss).
- Complaints move to Support in Phase 5.

### Phase 3: Requests and Give-aways

**Backend**

- Add an `item_request_events` table (`request_id, from_status, to_status, actor_id, created_at`). Every status change in `ItemRequestService` writes to it, which gives request history.
- Add a cron job to expire stale `pending` requests. The `expired` status exists but nothing sets it; the timeout is an open question below.
- `GET /admin/requests` with filters (status, item, requester, owner, date).
- `GET /admin/requests/:id` with its history.
- `GET /admin/items/:id/requests`: ordered by `created_at`, with the confirmed one marked as selected.
- `GET /admin/giveaways?stage=`: derived stages, no new table.
  - **Active:** item available and has pending requests.
  - **Awaiting pickup:** request confirmed.
  - **Completed**
  - **Cancelled**
- `POST /admin/requests/:id/cancel` `{reason}` (admin only), for stuck exchanges.

**Back office**

- Requests list, then a detail page with a history timeline.
- Give-aways board, with counts per stage and a table per stage. Flag "awaiting pickup > N days" as stuck.

### Phase 4: Dashboard and Locations

**Backend**

- `GET /admin/stats/overview?range=7d|30d` returns:
  - users: total, new, active (`last_active` inside the range)
  - listings: active and new
  - requests
  - completed give-aways
  - pending reports
  - suspended and banned users
  - listings with no requests
- `GET /admin/stats/activity`: the latest audit log and system events.
- `GET /admin/stats/locations?group=city|area`: listings, users and requests per area, with a flag for areas with little or no stock (few available listings compared with users or requests).

**Back office**

- Dashboard: KPI tiles (each links to its filtered list), a recent-activity feed and a link out to PostHog.
- Locations: a sortable table by area. No map in V1.

### Phase 5: Categories and Support

**Backend**

- `PATCH /admin/categories/reorder` `{ids: [...]}`, which sets `display_order` in one transaction.
- Support built on complaints:
  - Extend the types (account, listing, report follow-up, general).
  - Add `reviewing`, an assignee and internal notes (reuse the Phase 2 notes table).
  - `GET /admin/support`, `PATCH /admin/support/:id`, `POST /admin/support/:id/reply`. The reply is stored as `admin_response` and the user gets a push.

**Back office**

- Categories: drag to reorder. Create, edit and turn on or off already work.
- Support inbox: list, filters and a detail page with reply and notes.

### Phase 6: Notifications (keep it small)

**Backend**

- Add `sendMulticast(tokens[])` to `FirebaseService`, batched in groups of 500, and remove invalid tokens it reports.
- Add a `notifications` table: `title, body, audience (all | user_ids), sent_by, sent_at, success_count, failure_count`.
- `POST /admin/notifications` (admin only) and `GET /admin/notifications` (history).
- Announcement banner: add an `announcements` table (`message, active_from, active_until, is_active`) and a public `GET /announcements/active` endpoint for the apps to read.

**Back office**

- A compose form (audience: everyone or pick users), a history table and an announcements list.

### Settings (runs alongside the other phases)

- Admin and moderator user list, role changes and a link to the Audit log filtered to admin actions.

## Order and effort

| Phase | Depends on | Rough size |
| --- | --- | --- |
| 0 Foundations | — | S |
| 1 Users + Listings | 0 | L |
| 2 Reports | 1 | M |
| 3 Requests + Give-aways | 0 | M |
| 4 Dashboard + Locations | 1, 3 (for full metrics) | M |
| 5 Categories + Support | 0, 2 (notes table) | S–M |
| 6 Notifications | 0 | S–M |

Phases 1 and 3 can run in parallel after Phase 0. A partial dashboard (users, listings, reports) can ship after Phase 1 and be finished after Phase 3.

## Open questions

Phase 1 assumed answers to 2, 3 and 5 (a suspension may end on its own; a banned user's account stays, so the same email or phone can't sign up again; hidden listings stay visible to their owner and keep their requests; moderators suspend, only admins ban). Confirm or correct them.

1. **Give-away stages.** Do we want two-sided pickup confirmation, with the sharer and the requester each confirming separately? That needs app changes and new columns. If not, the stages collapse to Active → Awaiting pickup → Completed / Cancelled. This plan assumes they collapse.
2. **Suspension vs ban.** Should a suspension always have an end date and lift itself when it passes? Can a banned user sign up again with the same phone number or email?
3. **Hidden listings.** When a listing is hidden, should its owner still see it (marked as hidden)? And do its pending requests get cancelled?
4. **Request expiry.** How long can a request stay `pending` before it expires?
5. **Moderator scope.** Can moderators suspend users, or only admins? This plan assumes moderators can suspend and only admins can ban.
6. **Existing app endpoints.** Keep `PATCH /user/:id {is_active}` and `DELETE /items/:id` as they are, or move the back office over to `/admin/*` and restrict those endpoints to their owners?
