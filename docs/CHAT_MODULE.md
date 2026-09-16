# Chat

Direct messaging between two users, with optional item context.

Everything is available over both REST and a socket. The socket is for
liveness only — anything you can do over it you can also do over REST, so a
client that cannot hold a connection open still works, it just polls.

---

## Model

**One thread per pair of users, for all time.** `POST /chat/conversations`
with the same `recipient_id` always returns the same thread.

The item is **context, not identity**. Opening a chat from a different item
re-points the existing thread's banner at the new item rather than starting a
second thread. A thread with no item at all is a plain direct chat.

In the database the pair is stored canonically — `user_a_id` always holds the
smaller UUID — which is what makes "one thread per pair" enforceable by a
unique index. Clients never see this: the API only ever talks about
`participant`, the person who is not you.

---

## REST

All routes require `Authorization: Bearer <access token>` and return the
standard `{ state, data, message, statusCode }` envelope.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/chat/conversations` | Open (or reuse) a thread. Body: `recipient_id`, optional `item_id`. |
| `GET` | `/chat/conversations` | Chat list. Query: `page`, `limit`, `search`. |
| `GET` | `/chat/unread-count` | Badge for the chat tab. |
| `GET` | `/chat/conversations/:id` | One thread. |
| `GET` | `/chat/conversations/:id/messages` | A page of messages. Query: `before`, `limit`. |
| `POST` | `/chat/conversations/:id/messages` | Send text. Body: `content`. |
| `POST` | `/chat/conversations/:id/messages/image` | Send an image. Multipart: `image`, optional `caption`. |
| `PATCH` | `/chat/conversations/:id/read` | Mark the thread read. |
| `DELETE` | `/chat/messages/:id` | Retract your own message. |

`search` matches the other participant's name and the last message preview.

### Message pagination

Messages come back **newest first**, and paginate on a cursor rather than an
offset, because threads grow while they are being scrolled and an offset would
skip or repeat rows as everything shifts.

To load older messages, pass the `id` of the oldest message you hold:

```
GET /chat/conversations/<id>/messages
GET /chat/conversations/<id>/messages?before=<id of oldest message you have>
```

You have reached the top when a page comes back shorter than `limit`.

---

## The item banner

`conversation.item` is the strip pinned above the message list. It is `null`
for a plain direct chat.

```jsonc
{
  "id": "…", "title": "Red USB cable with headphones",
  "image_url": "https://res.cloudinary.com/…",
  "status": "reserved",          // the item's own status
  "owner_id": "…",
  "is_mine": false,              // true when YOU own the item
  "request_id": "…",
  "request_status": "confirmed", // pending | confirmed | cancelled | completed | expired
  "is_pending_pickup": true,     // open request, not yet handed over
  "picked_up_at": null           // set once pickup is confirmed
}
```

Render `is_pending_pickup` as **"Pending pickup"** and a non-null
`picked_up_at` as **"Picked up on <date>"**.

Confirming the pickup itself is not a chat call — it is the existing
`PATCH /item-requests/:requestId/pickup`. Chat only reflects the result.

---

## System messages

When something happens to the shared item, the backend drops a card into the
thread: `message_type: "system"` with a `system_event` and a `metadata`
snapshot of the item.

| `system_event` | Raised when |
| --- | --- |
| `item_requested` | A user requests an item |
| `request_confirmed` | The owner confirms the request |
| `request_cancelled` | Either party cancels |
| `pickup_confirmed` | The requester confirms pickup |

**One row renders two ways.** `sender_id` is whoever caused the event, so use
`is_mine` to pick the wording. For `item_requested`:

- `is_mine: true` → "You've requested for <owner>'s item!"
- `is_mine: false` → "<requester> has requested for your item!"

`metadata` carries `item_id`, `item_title`, `item_image_url` and `request_id`.
It is a **snapshot** taken when the event happened, so the card still renders
correctly after the item is edited or deleted — use it rather than re-fetching
the item.

System messages count toward unread like any other message, and cannot be
deleted.

---

## Socket

Namespace `/chat`, authenticated with the same access token as REST:

```js
io('https://<host>/chat', { auth: { token: accessToken } })
```

`Authorization: Bearer …` as a header, or `?token=`, also work. The token's
session is re-checked on connect, so revoking a session drops new sockets the
same way it rejects REST calls. A socket that fails to authenticate receives
`error` and is disconnected — with no detail, deliberately.

### Server → client

| Event | Payload |
| --- | --- |
| `message:new` | The full message, shaped for you (`is_mine` set from your side). |
| `message:read` | `{ conversation_id, reader_id, message_ids[], read_at }` |
| `message:deleted` | `{ conversation_id, message_id }` |
| `conversation:updated` | `{ conversation_id, last_message_at?, last_message_preview?, unread_count? }` |
| `typing` | `{ conversation_id, user_id, is_typing }` |
| `presence` | `{ user_id, is_online, last_active }` |
| `unread:count` | Sent once on connect. |
| `error` | `{ message }` |

### Client → server

| Event | Payload |
| --- | --- |
| `message:send` | `{ conversation_id, content, client_message_id? }` |
| `message:read` | `{ conversation_id }` |
| `typing:start` / `typing:stop` | `{ conversation_id }` |

Each returns an ack in the same envelope REST uses. `message:send` echoes
`client_message_id` back on the ack so you can reconcile the optimistic bubble
you already drew.

You receive `message:new` for your own sends too, on **all** your devices —
that is how a second device stays in step. Deduplicate on message `id`.

### Typing

Typing is relayed, never stored. Clear the indicator yourself after ~8s
(`timeout_ms` on the ack) if no `typing:stop` arrives, so a dropped connection
does not leave "typing…" on screen forever.

---

## Read receipts and unread counts

`PATCH /chat/conversations/:id/read` (or the `message:read` socket event)
stamps every message addressed to you in that thread and resets your counter.
The other party gets `message:read` with the affected ids — that is the tick
in the mockups.

Counters live on the conversation row and are moved in the same transaction as
the message, so they cannot drift from the messages themselves.

---

## Blocking

Blocking reuses the existing moderation `blocked_users` table. If either party
has blocked the other, opening a thread and sending both return **403**, worded
identically in each direction so it does not reveal who blocked whom. Existing
history stays readable.

Suspended accounts are refused by `ActiveUserGuard`, as elsewhere.

A conversation that is not yours returns **404**, not 403 — a 403 would confirm
to a stranger that two people are talking.

---

## Push notifications

If the recipient has no live socket, the message is sent as an FCM push to
their `fcm_token` (respecting `notification_enabled`), with
`data.type = "chat_message"` plus `conversation_id`, `message_id` and
`sender_id` for deep-linking.

Pushes are best-effort: a failed push never fails the send.

---

## Deploying to the VPS

Chat needs three things the previous release did not: **two new tables**, a
**WebSocket route through nginx**, and (for push) **Firebase credentials**.
Nothing else about the deploy changes.

### 1. Check the environment

Chat reads these on top of what the app already needed:

| Variable | Used for | If missing |
| --- | --- | --- |
| `JWT_SECRET` | Authenticating socket handshakes | App will not boot (already required) |
| `CLOUDINARY_*` | Image messages | App will not boot (already required) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` *or* `FIREBASE_SERVICE_ACCOUNT_PATH` | Push when the recipient is offline | **Boots fine, pushes silently disabled** |

The Firebase one is the trap: the app logs
`Firebase credentials not found. Firebase features will be unavailable.` and
carries on. Text chat works, offline users just never get notified. Grep the
boot log for that line.

Also confirm `NODE_ENV=production` on the server. It controls two things that
matter here — see the next step.

### 2. Migrations

`CreateChatTables1788000000000` creates `conversations` and `chat_messages`.

**With `NODE_ENV=production`, TypeORM runs pending migrations automatically on
boot** (`migrationsRun: isProduction` in `src/config/typeorm.config.ts`), so
starting the app is enough. That is convenient and also the risk: it runs
*every* pending migration, not just this one. Check what is outstanding before
you restart:

```bash
npm run migration:show     # [ ] = pending, [X] = applied
```

If anything older than the chat migration is pending, decide about those
deliberately rather than letting a restart apply them. To run them yourself
first and keep the restart boring:

```bash
npm run migration:run
```

Also note `synchronize` is forced off whenever `DATABASE_URL` is set, and off
anyway under `NODE_ENV=production`. If the server is *not* set to production
and has no `DATABASE_URL`, TypeORM would instead try to auto-shape the schema
from the entities — don't deploy in that state.

### 3. Build and restart

Fork mode, one instance — see the PM2 note below.

```bash
cd /path/to/free-backend
git pull
npm ci
npm run build
pm2 restart free-backend --update-env
pm2 logs free-backend --lines 50
```

Look for these two lines:

```
Chat gateway listening on /chat
Nest application successfully started
```

If the first is absent, the module did not initialise and only REST will work.

### 4. nginx

A reverse proxy does not pass a WebSocket handshake through by default.
Without the upgrade headers socket.io quietly falls back to HTTP long-polling:
chat still appears to work, but every client is polling and
`proxy_read_timeout` starts cutting connections.

The socket.io endpoint is **`/socket.io/`** — `/chat` is the namespace, which
travels *inside* the connection, not in the URL. So `/socket.io/` is the path
that needs the upgrade headers.

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    # ... your ssl_certificate directives ...

    # WebSocket transport for chat.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long-lived connections; socket.io pings every 25s.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_buffering off;
    }

    # Everything else, including the /chat REST routes.
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`proxy_pass` targets port **3000** to match `PORT` in the server's `.env`. If
you change one, change the other.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Verify it actually upgraded

Two checks, no client library needed.

**Does socket.io reach the app at all?**

```bash
curl -i "https://api.example.com/socket.io/?EIO=4&transport=polling"
```

Expect `200` and a body starting `0{"sid":"…","upgrades":["websocket"],…`.
A 404 means nginx is not routing `/socket.io/` to the app.

**The trailing slash matters.** `/socket.io/?EIO=4…` returns the handshake;
`/socket.io?EIO=4…` (no slash) is a plain 404 from the Nest router. That is
why the nginx `location` block above is `/socket.io/` and not `/socket.io` —
don't "tidy" it.

**Does the WebSocket upgrade succeed?**

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  "https://api.example.com/socket.io/?EIO=4&transport=websocket"
```

Expect `HTTP/1.1 101 Switching Protocols`. Anything else — typically `200` or
`400` — means the upgrade headers are not being forwarded, and every client is
silently stuck on polling.

**Does REST work?**

```bash
curl -s -H "Authorization: Bearer <token>" \
  https://api.example.com/chat/unread-count
```

Expect `{"state":true,"data":{"total_unread":0,…}}`. A 500 here usually means
the migration has not run.

### 6. Rollback

The chat tables are additive — nothing existing reads them, so rolling the app
back does not require rolling the schema back. If you do need to drop them:

```bash
npm run migration:revert   # reverts CreateChatTables1788000000000
```

Uploaded chat images live in the `chat/` folder in Cloudinary and are not
touched by that.

---

## PM2: fork mode only, unless the Redis adapter is wired

Presence and socket rooms are held **in memory, in one process**. That is
correct under `pm2 start dist/main.js` (fork mode, a single instance), which is
how this is deployed.

**Do not switch to `pm2 start -i max` / cluster mode as things stand.** Each
worker would keep its own rooms and presence map, so two users on different
workers would see each other as permanently offline and would not receive each
other's `message:new`, `typing` or `message:read` events. Messages would still
be stored correctly and would still arrive as FCM pushes, which is what makes
the failure easy to miss — the thread looks right after a refresh, but it is
not live.

To run more than one worker, add a socket.io Redis adapter
(`@socket.io/redis-adapter`) so rooms and presence are shared. The Redis in
`docker-compose.yml` is suitable; the Upstash REST client this project can
alternatively be configured with is **not**, because it has no pub/sub. Behind
a load balancer, also enable sticky sessions, or force
`transports: ['websocket']` on the client so there is no polling handshake to
split across workers.
