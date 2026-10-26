# Phone sign-in SMS providers

Phone sign-in codes can be sent by **Firebase** (the Firebase SDK on the device) or by **Twilio Verify** (through the backend). Either way the user ends up signed in to the same Firebase account and finishes with `POST /auth/firebase-login`, so accounts, sessions and the rest of the app are the same.

## Switching

| Setting | Effect |
|---|---|
| `SMS_PROVIDER=firebase` (default) | Clients send with Firebase. If Firebase refuses to send and the fallback is on, they use the backend. |
| `SMS_PROVIDER=twilio` | Clients always use the backend. |
| `SMS_FALLBACK_ENABLED=false` | No fallback while the provider is `firebase`. |
| `SMS_ALLOWED_PREFIXES=+233` | Numbers the backend will text (comma-separated). Keep it in step with the Firebase SMS region policy. |

Twilio is only offered to clients once `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_VERIFY_SERVICE_SID` are all set; until then `GET /auth/sms/config` reports Firebase with no fallback. Changing these needs a backend restart, not an app release: clients read the config on every sign-in.

### Twilio setup

1. Twilio Console → Verify → Services → create a service (code length 6). Copy its SID (`VA…`).
2. In the service, check that Ghana is allowed under Geo permissions, and leave Fraud Guard on.
3. Set the three `TWILIO_*` variables and restart.

## Client flow

1. `GET /auth/sms/config` → `{ provider, fallback }`.
2. If `provider` is `firebase`, send with the Firebase SDK as before. If it fails for **any** reason other than the user's input (`invalid-phone-number`, `missing-phone-number`), and `fallback` is `twilio`, continue at step 3. Never show Firebase's error. The backend and Twilio apply their own limits, so falling back on Firebase's rate limits is fine. See [User messages](#user-messages).
3. `POST /auth/sms/send-code` `{ "phone_number": "+233241234567" }`.
4. `POST /auth/sms/verify-code` `{ "phone_number": "+233241234567", "code": "123456" }` → `data.firebase_token`.
5. `signInWithCustomToken(firebase_token)` in the Firebase SDK, then `POST /auth/firebase-login` with the ID token, as after Firebase phone auth.

The token is for the Firebase account of the backend account that already has this number verified, if any, so one person isn't split across two Firebase accounts; otherwise the Firebase account with this number, created on first sign-in. A disabled Firebase account fails at step 5 with `auth/user-disabled`; show that as the account being disabled.

### User messages

What the website shows, and the Android app should match, so a Firebase failure never surfaces as an error:

| When | Message |
|---|---|
| As soon as the user taps Send | "Sending your code… this can take a few seconds." |
| Firebase hasn't answered after 8 s | "This is taking a little longer than usual. Hold on…" |
| Firebase failed; switching to step 3 | "Taking longer than usual. Hold on, we're sending your code another way…" (keep it up at least 2 s, even if the server answers sooner) |
| The server hasn't answered 8 s after the switch | "Still sending — this can take up to half a minute. Keep this page open." |

An error is shown only when the fallback is off or the backend itself refuses; show its `message`.

| Status | Meaning |
|---|---|
| 400 | Bad number, wrong code, expired code, or a number Twilio won't text. `message` is user-facing. |
| 429 | Too many sends or checks (per IP here, per number at Twilio). |
| 503 | Backend SMS is switched off or Twilio is unreachable. |

The website does this in `src/app/founding-freers/founding-form.tsx` (free-website).
