# Brief: auth changes for the mobile app

## What changed and why

Firebase phone auth is refusing to send SMS to many Ghana numbers: Firebase's SMS fraud protection blocks them. The backend now has a second sender for both sign-in methods:

- **Phone:** SMS codes through Twilio, sent by the backend.
- **Email:** 6-digit codes emailed by the backend, instead of Firebase sign-in links.

**After any backend code, sign-in finishes exactly as today:** the backend returns a Firebase custom token. You call `signInWithCustomToken(token)`, then `POST /auth/firebase-login` with the ID token and `fcm_token`, as you do now. Accounts, sessions and onboarding are unchanged.

Full API details: [SMS_PROVIDERS.md](SMS_PROVIDERS.md) and [EMAIL_SIGN_IN.md](EMAIL_SIGN_IN.md).

## 1. Read the config each time the user taps Send

```
GET /auth/sms/config   → data: { provider: "firebase" | "twilio", fallback: "twilio" | null }
GET /auth/email/config → data: { provider: "firebase" | "server", fallback: "server" | null }
```

- Use a short timeout of about 5 s. If the request fails, behave as `{ provider: "firebase", fallback: null }`.
- Ops can switch providers without an app release, so don't cache the config.

## 2. Phone sign-in

```
if provider == "twilio":                      → send via backend (step 3)
else:
    try Firebase verifyPhoneNumber
    on failure:
        if fallback == "twilio" AND error is not the user's input AND device is online:
            → send via backend (step 3)
        else: show the error
```

- **Fall back on any Firebase failure except an invalid or missing phone number.** That includes reCAPTCHA/Play Integrity failures, app-credential errors, quota, too-many-requests, internal errors, and the "error code 39" SMS block. Don't fall back when the device is offline.
- **Give up on Firebase after 25 s with no result and fall back.** A verification challenge the user dismisses may never call back.
- **Never show Firebase's error when you fall back.** Show the progress messages in section 5 instead.

**Step 3, the backend send:**

```
POST /auth/sms/send-code    { "phone_number": "+233241234567" }
POST /auth/sms/verify-code  { "phone_number": "+233241234567", "code": "123456" }
                            → data.firebase_token
signInWithCustomToken(firebase_token) → POST /auth/firebase-login (as today)
```

- **If `signInWithCustomToken` fails on a network error,** retry it with the same token, which is valid for 1 hour. Don't call verify-code again: the code is already used up. On any other error, drop the token.

## 3. Email sign-in

Same pattern as phone:

```
provider == "server"  → backend code
provider == "firebase"→ Firebase email link; on any failure except invalid/missing email
                        (and online) with fallback == "server" → backend code

POST /auth/email/send-code    { "email": "ama@example.com" }
POST /auth/email/verify-code  { "email": "...", "code": "123456" } → data.firebase_token
→ signInWithCustomToken → POST /auth/firebase-login
```

- **"Send a new code" from the code screen goes straight to `/auth/email/send-code`.** Don't retry the Firebase link: the user expects a code, not a link.

## 4. Adding an email to a phone account (optional, new)

This replaces `linkWithCredential` + `POST /user/email` if you want a code-based flow. It needs `Authorization: Bearer <access_token>`:

```
POST /auth/email/link/send-code    { "email": "..." }
POST /auth/email/link/verify-code  { "email": "...", "code": "123456" } → updated user (like POST /user/email)
```

- **409:** another account already has that email. Tell the user to sign in with an email code instead.
- **The existing `POST /user/email` flow still works.**

## 5. What the user sees

Match the website's wording exactly:

| When | Message |
|---|---|
| User taps Send | "Sending your code… this can take a few seconds." |
| Firebase silent for 8 s | "This is taking a little longer than usual. Hold on…" |
| Switching to the backend (show at least 2 s) | "Taking longer than usual. Hold on, we're sending your code another way…" (email: "…we're emailing you a code instead…") |
| Backend silent for 8 s after the switch | "Still sending — this can take up to half a minute. Keep this page open." |
| Under the code boxes after a fallback or a resend | "If two codes arrive, use the newest one." |

**Resend:**
- Disable "Send a new code" for **60 s** after a code is sent, showing "Send a new code in 42s". The backend refuses a second code for the same number or email within a minute.
- Apply the same countdown if the user goes back and enters the same number or email again.

## 6. Backend errors

Every response has the shape `{ state, statusCode, message, data }`. Show `message` to the user as-is.

| Status | Meaning |
|---|---|
| 400 | Wrong or expired code, or bad input. Each code allows 5 guesses and expires after 10 minutes. |
| 409 | The email belongs to another account (add-email flow). |
| 429 | Too many requests: a resend within a minute, or rate limits. |
| 503 | Backend sending is switched off or temporarily unavailable. |

- **Disabled accounts:** if `signInWithCustomToken` fails with `user-disabled`, show "This account has been disabled. Contact Freeee support if you think this is a mistake."

## 7. Requirements and testing

- **Firebase Android SDK 23.1.0 or later.** Firebase requires it for its SMS fraud protection.
- **Twilio is on a trial account for now:**
  - It only texts verified numbers (currently +233 59 939 7566).
  - Every SMS starts with "[SAMPLE TEST]".
  - Ask the backend team to add your test numbers.
- **To exercise the fallback,** test against a backend with `SMS_PROVIDER=firebase` and `SMS_FALLBACK_ENABLED=true`. While Firebase is blocking Ghana numbers, the fallback triggers naturally. To test the backend path alone, ask for `SMS_PROVIDER=twilio`.
