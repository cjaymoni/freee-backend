# Android Integration Guide

Everything an Android client needs to talk to the Freee backend — where it lives,
how auth works, and the handful of places this API will surprise you.

| | |
| --- | --- |
| **Base URL** | `https://perspectiv.live/free-backend` |
| **Interactive docs** | `https://perspectiv.live/free-backend/api` |
| **OpenAPI JSON** | `https://perspectiv.live/free-backend/api-json` |

---

## 1. The prefix is not optional

Nginx routes `/free-backend/` to the API and everything else to a Next.js
frontend. Hit the host without the prefix and you get the frontend's HTML 404
page, not a JSON error — which looks like a broken endpoint but is really a
routing miss.

| Request | Result |
| --- | --- |
| `/free-backend/items` | **200** — JSON from the API |
| `/items` | **404** — HTML from the Next.js app |

Nginx strips the prefix before forwarding, so paths inside your Retrofit
interface stay unprefixed. Put `/free-backend/` in the base URL once and forget
it.

```kotlin
Retrofit.Builder()
    .baseUrl("https://perspectiv.live/free-backend/")  // trailing slash matters
    .build()
```

---

## 2. Quick start

Firebase is the intended path for mobile — the backend tags those sessions as
`mobile` and, unlike email login, it won't sign the user out on their other
devices.

### Prerequisite: the app must live in the `freeee-app` project

The backend verifies ID tokens with the Firebase Admin SDK, which checks that
the token's audience matches its own project. **A token minted by any other
Firebase project is rejected** — so the Android app cannot use a project the
developer creates themselves. It has to be registered under `freeee-app`.

Someone with access to that project needs to do the following once:

1. **Firebase Console → Project settings → Add app → Android.**
   Requires the app's `applicationId` (package name) from the developer.

2. **Add the SHA-1 fingerprint** of the developer's debug signing certificate —
   and the release/upload certificate before shipping. Required for Google
   Sign-In and Phone Auth. The developer gets theirs with:

   ```bash
   ./gradlew signingReport
   ```

   One SHA-1 per developer machine; they can be added at any time.

3. **Download `google-services.json`** and hand it to the developer. It goes in
   the app module directory (`app/google-services.json`).

4. **Authentication → Sign-in method:** enable the providers the app will
   actually use — Google, Email/Password, Phone.

> **`google-services.json` is not a secret credential.** It holds client
> configuration and ships inside every APK, so it is fine to send to the
> developer. Treat it as config, not as a key — but still keep it out of public
> repositories.
>
> **Never share `FIREBASE_SERVICE_ACCOUNT_JSON`.** That is the backend's admin
> credential with full project access, including the ability to mint tokens for
> any user. It belongs only in the server's environment.

The ID token must carry an **email or a phone number** — the backend matches an
existing user on `firebase_uid` first, then falls back to email or phone. A
provider that supplies neither (anonymous auth) has nothing to match on.

### Then, in the app

1. **Add Firebase Auth to the app.** Sign the user in however you like — Google,
   email link, phone.

2. **Exchange the Firebase ID token for API tokens.**
   `POST /auth/firebase-login` with the token from `FirebaseUser.getIdToken()`:

   ```json
   { "idToken": "eyJhbGciOi..." }
   ```

3. **Store the pair.** You get back a short-lived `access_token` and a 7-day
   `refresh_token`. Keep both in `EncryptedSharedPreferences` — the refresh
   token is a bearer credential in its own right.

4. **Attach the access token to every call.** An OkHttp `Interceptor` adds the
   header; an `Authenticator` handles the refresh when it expires. Both are
   sketched in §5.

   ```http
   Authorization: Bearer <access_token>
   ```

---

## 3. Two auth flows, two different response shapes

Both issue the same kind of token pair, but they do not wrap it the same way and
they do not treat existing sessions the same way.

### Firebase — recommended for mobile

`POST /auth/firebase-login` · body `{ idToken }`

Response is **wrapped** in the standard envelope; tokens are under `data`:

```json
{
  "state": true,
  "statusCode": 200,
  "message": "Authentication successful",
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "user": { "id": "...", "email": "...", "role": "USER",
              "is_onboarded": true, "avatar": "..." }
  }
}
```

Other sessions are left alone — the user stays signed in on their other devices.

### Local — email and password

`POST /auth/login` · body `{ email, password }` (password min 6 chars)

Response is **not wrapped**. The token object is the whole body:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "user": { "id": "...", "email": "...", "first_name": "...",
            "last_name": "...", "avatar": "..." }
}
```

All previous sessions are deactivated. Signing in here signs the user out
everywhere else.

> **Don't share one response model between them.** `/auth/login` and
> `/auth/refresh` return bare token objects; `/auth/firebase-login` and
> essentially every other endpoint return the
> `{ state, message, data, statusCode }` envelope. Model them as two separate
> types.

### If you also support email signup

| Method | Endpoint | Body |
| --- | --- | --- |
| `POST` | `/auth/register` | `email`, `password`, optional `phone_number` |
| `POST` | `/auth/verify-email` | `email`, `code` — exactly 6 digits, expires in 10 min |
| `POST` | `/auth/resend-verification` | `email` |
| `POST` | `/auth/forgot-password` | `email` — sends a 6-digit code |
| `POST` | `/auth/reset-password` | `email`, `code`, new password |

Accounts start inactive. Until the email is verified, login fails with
*Account is not active* — surface that as "check your email", not as a
wrong-password error.

---

## 4. Token lifecycle

This is the part most likely to bite you. **There is no sliding window** —
activity does not extend a session.

| | Lifetime |
| --- | --- |
| `access_token` (JWT) | 15 minutes |
| Server-side session row | 15 minutes |
| `refresh_token` | 7 days, **rotated on every use** |

The JWT and the session row expire together at 15 minutes. Every authenticated
request checks both, so a valid-looking JWT still fails once the session lapses.

`POST /auth/refresh` with `{ refresh_token }` returns a fresh pair — unwrapped:

```json
{ "access_token": "...", "refresh_token": "..." }
```

**Rotation is strict.** The old refresh token is deactivated the moment it is
used. If two requests refresh concurrently, one wins and the other's token is
already dead — so the refresh must be single-flight. Persist the new pair before
releasing the lock.

---

## 5. Wiring it into OkHttp

An interceptor for the happy path, an authenticator for the 401. The
`synchronized` block is what keeps rotation from eating itself.

```kotlin
// 1. Attach the access token to every outgoing request.
class AuthInterceptor(private val store: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = store.accessToken
        val req = if (token == null) chain.request()
        else chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(req)
    }
}

// 2. On a 401, refresh once and replay. Single-flight, because the
//    refresh token is rotated and the old one dies immediately.
class TokenAuthenticator(
    private val store: TokenStore,
    private val authApi: AuthApi,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        // Already retried once - stop, or we loop forever.
        if (response.priorResponse != null) return null

        val stale = response.request.header("Authorization")
            ?.removePrefix("Bearer ")

        val fresh = synchronized(this) {
            // Another thread may have refreshed while we waited on the lock.
            if (store.accessToken != stale) return@synchronized store.accessToken

            val refresh = store.refreshToken ?: return null
            val res = authApi.refresh(RefreshRequest(refresh)).execute()
            if (!res.isSuccessful) { store.clear(); return null }  // force re-login

            res.body()!!.also { store.save(it.accessToken, it.refreshToken) }.accessToken
        } ?: return null

        return response.request.newBuilder()
            .header("Authorization", "Bearer $fresh")
            .build()
    }
}
```

### Response models

```kotlin
// Most endpoints. Lists add total / page / limit.
data class Envelope<T>(
    val state: Boolean,
    val message: String,
    val data: T?,
    val statusCode: Int,
    val total: Int? = null,
    val page: Int? = null,
    val limit: Int? = null,
)

// /auth/login and /auth/refresh only - no envelope.
data class TokenPair(
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "refresh_token") val refreshToken: String,
)

// Errors, on every endpoint.
data class ApiError(
    val state: Boolean,     // always false
    val message: String,    // may be a String OR a String[] on 400
    val error: String,
    val statusCode: Int,
)
```

Validation failures return `message` as an **array** of strings, one per failed
field; everything else returns a single string. Use a lenient adapter or you
will crash on the first bad form submission.

---

## 6. Sharp edges

Ordered by how much time each one costs before you spot it.

### Breaks things

**Unknown request fields are rejected outright.** The server validates with
`whitelist` and `forbidNonWhitelisted`. Any property not on the DTO returns
**400 — `property foo should not exist`**. Sending an extra `id`, a stray
analytics field, or a misspelled key all fail the same way. Send exactly the
documented fields, nothing more.

**Refreshing from two threads logs the user out.** Refresh tokens rotate: using
one immediately deactivates it. Two parallel 401s each triggering a refresh
means the second call presents a dead token, gets rejected, and your error path
clears the session. Guard the refresh with a lock — the `Authenticator` above
does.

### Subtle

**Email login silently ends the user's other sessions.** `/auth/login`
deactivates every existing session for that user. If someone is signed in on the
web and then signs in on the phone by email, the web session dies with no
notification. `/auth/firebase-login` does not do this.

**Sessions expire on a hard 15-minute clock.** There is no sliding renewal — a
user actively tapping through the app still gets a 401 at the 15-minute mark.
Treat 401 as routine and always recoverable via refresh, not as a sign-out.

**A user can only fetch their own profile.** `GET /user/{id}` returns **403**
unless the id is the caller's own or the caller is an admin. To show another
person — an item's owner, a requester — use the trimmed user object already
embedded in item and request responses rather than a second lookup.

### Know it

**Rate limiting only covers `/auth`.** 100 requests per minute applies to the
auth routes. Everything else is currently unthrottled, so nothing stops a
runaway retry loop server-side — put the backoff in the client.

**Items in `used` condition cannot be requested.** The request endpoint rejects
them with a 400, and you cannot request your own item. Hide or disable the
request button in both cases rather than surfacing the error.

**Uploads go up to 50 MB, as multipart.** Item images use
`multipart/form-data`. Compress on device anyway — this is a mobile-first
audience and the ceiling is not a target.

---

## 7. The item request lifecycle

Four states, and each transition is a different endpoint with a different caller.

| Method | Endpoint | Who calls it | Effect |
| --- | --- | --- | --- |
| `POST` | `/item-requests` | Requester | Creates a `pending` request. One active request per person per item. |
| `PATCH` | `/item-requests/{id}/confirm` | Owner | Becomes `confirmed`, item becomes `reserved`, a 6-character pickup code is generated. |
| `PATCH` | `/item-requests/{id}/pickup` | Requester | Requires the pickup code. Becomes `completed`, item becomes `picked_up`. |
| `PATCH` | `/item-requests/{id}/cancel` | Either party | Becomes `cancelled`. `cancellation_reason` is optional. A confirmed request releases the item back to `available`. |
| `GET` | `/item-requests/my-requests` | Requester | Requests this user has made. |
| `GET` | `/item-requests/received` | Owner | Requests on this user's items. |
| `GET` | `/item-requests/{id}` | Either party | 403 for anyone else. Carries the pickup code. |

Only one request per item can be confirmed at a time — a second confirm returns
**409**. Once confirmed, the item is reserved until that request is completed or
cancelled.

---

## 8. Everything else

All authenticated with the same bearer token. Lists take `page` and `limit`,
defaulting to 1 and 20.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/items` | Browse. Works signed out, but include the token — the response then carries `is_saved` per item. |
| `GET` | `/items/{id}` | Detail. Records a view, deduplicated per user per item. |
| `POST` | `/items` | Create a listing. |
| `GET` | `/items/my-items` | The signed-in user's listings. |
| `POST` | `/items/{itemId}/images` | Multipart upload. |
| `GET` | `/categories` | Seeded and stable — cache it locally. |
| `POST` | `/saved-items` | Save an item. |
| `DELETE` | `/saved-items/{itemId}` | Unsave. |
| `GET` | `/auth/me` | The signed-in user's own profile. |
| `POST` | `/auth/logout` | Deactivates the current session. |
| `POST` | `/moderation/users/block` | Block a user. Reporting lives under the same prefix. |
| `GET` | `/health` | Unauthenticated. Useful as a connectivity probe. |

There are 100 routes in total. The live Swagger UI at `/free-backend/api` is
authoritative — generate your client from `/free-backend/api-json` if you would
rather not hand-write the interface.

---

## 9. Environment

| | |
| --- | --- |
| Host | `perspectiv.live` |
| Path prefix | `/free-backend` |
| TLS | Valid, via Cloudflare |
| Access token TTL | 15 minutes |
| Refresh token TTL | 7 days, rotating |
| Max upload | 50 MB |

The certificate chains to a public root, so no network security config or
certificate pinning setup is needed to get started.

This is a shared development environment — its database is not production data,
and it is rebuilt from time to time.

---

*Generated from the live OpenAPI document and the backend source. Where this
page and `/free-backend/api` disagree, Swagger is current.*
