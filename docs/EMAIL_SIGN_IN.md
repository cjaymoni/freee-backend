# Email sign-in and adding an email

Email sign-in can use a **Firebase email link** (sent by Firebase's mailer) or a **6-digit code** sent by the backend over our SMTP. Either way the user ends up signed in to the Firebase account that owns the email and finishes with `POST /auth/firebase-login`, so accounts, onboarding and sessions don't change. This is the email counterpart of [SMS_PROVIDERS.md](SMS_PROVIDERS.md).

## Switching

| Setting | Effect |
|---|---|
| `EMAIL_PROVIDER=firebase` (default) | Clients send a Firebase email link. If Firebase refuses and the fallback is on, they ask the backend for a code. |
| `EMAIL_PROVIDER=server` | Clients always ask the backend for a code. |
| `EMAIL_FALLBACK_ENABLED=false` | No fallback while the provider is `firebase`; the backend refuses sign-in codes. |

Clients read `GET /auth/email/config` → `{ provider, fallback }` on every sign-in, so a change needs a backend restart, not an app release.

## Sign-in with a code

1. `POST /auth/email/send-code` `{ "email": "ama@example.com" }`.
2. `POST /auth/email/verify-code` `{ "email": "...", "code": "123456" }` → `data.firebase_token`.
3. `signInWithCustomToken(firebase_token)`, then `POST /auth/firebase-login` with the ID token.

With `provider: firebase`, send the Firebase link first. If that fails for **any** reason other than the user's input (`invalid-email`, `missing-email`), and `fallback` is `server`, continue at step 1 instead of showing Firebase's error. Show the same progress messages as phone sign-in ([SMS_PROVIDERS.md, User messages](SMS_PROVIDERS.md#user-messages)), with "Taking longer than usual. Hold on, we're emailing you a code instead…" for the switch. A mail server can take up to ~30 s to accept the code, which is why the "Still sending…" message matters here.

Codes: 6 digits, stored hashed, valid 10 minutes, single use, and only the newest one works. Limits:

- 5 wrong guesses per code, counted atomically before the check.
- 30 guesses per email per day across its sign-in and add-email codes (not password-reset or verification codes, which anyone can set off). This is the bound on guessing (30 in 900,000). It is counted on guesses rather than codes sent, so sending codes to an address alone can't shut it. Guessing can: anyone who knows an address can spend its 30 and close email codes for it until the next day. Some per-address cap is the price of bounding guesses; the Firebase link and phone sign-in still work meanwhile.
- One new code a minute per email, 5 an hour per email from one IP, 20 a day per email. A code whose email failed to send counts toward none of these.
- Sends and checks are also limited per IP.

Time windows are measured by the database clock, the same clock that stamps the codes. If the step after a right code fails (say Firebase is briefly down), the code can be used again; the right guess is refunded, so this works even on its fifth guess.

### Which Firebase account the code signs in to

1. If a backend account already has this email **verified**, its Firebase account, so one person isn't split across two Firebase accounts. The email is filled in on that Firebase account only if it has none, or has this one unverified; a different email there is its password sign-in and is left alone.
2. Otherwise the Firebase account holding the email **verified**, untouched.
3. Otherwise a **new** Firebase account, created with the email verified.

A Firebase account holding the email **unverified** is always **deleted** first, never handed over. Anyone can create one with someone else's address, set a password, link their own phone or Google, and build a backend account behind it. Taking over an account that someone else could use until a moment ago can't be done safely: every way of signing in, refreshing or editing would race the takeover. Firebase can't take an email off an account, so deleting it is the only way to free the email.

- Its backend account, if any, keeps its data, phone and sessions. It loses only the unverified email, to the verified sign-in (`resolveFirebaseLink`).
- If that was the prover's own account (a sign-up whose email was never verified), they now have two: the new one, and the old one with their data. Each delete is logged with the old backend account id ("Proven email freed from an unverified Firebase account bound to backend account …") so support can find it and merge.
- A banned or suspended user who never verified their email can start a clean account this way; the same log line shows the old account's status.
- Devices signed in to the deleted Firebase account are signed out. Two sign-ins racing to delete the same account both succeed.

## Adding an email after phone sign-up

For a signed-in user (`Authorization: Bearer <access_token>`), instead of `linkWithCredential` + `POST /user/email`:

1. `POST /auth/email/link/send-code` `{ "email": "ama@example.com" }`.
2. `POST /auth/email/link/verify-code` `{ "email": "...", "code": "123456" }` → the updated user, as `POST /user/email` returns it.

Both steps check first and send no code for an email that would get a 409. On Firebase:

- another Firebase account holding the email **verified** and bound to another backend account: 409, the accounts can't be merged here;
- one holding it verified that nobody is bound to (left by a sign-in that never finished): kept for a user without a Firebase account yet (their next email sign-in links to it), otherwise deleted so the email can go on the user's own Firebase account;
- one holding it **unverified**: deleted, as on sign-in.

Deletes happen before the email is saved and can't be undone; if saving then fails (another account claimed it meanwhile), the deleted account was one that would have been deleted anyway. On a right code the email is saved on the backend account as verified, and then put on the user's own Firebase account. If that last step fails, the backend keeps the email and the next email-code sign-in puts it on Firebase. A code only works for the user who asked for it, and one user's request never delays or cancels another's.

| Status | Meaning |
|---|---|
| 400 | Wrong or expired code, or bad input. `message` is user-facing. |
| 409 | Another account already has this email verified (backend, or Firebase bound to another account), or this account already has a different verified email. Ask the user to sign in with that email (by email code) instead. |
| 429 | Asked for a new code within a minute, too many codes or wrong guesses for this email, or too many requests. |
| 503 | Sign-in codes switched off, or the email couldn't be sent. |

The website does sign-in this way in `src/app/founding-freers/founding-form.tsx` (free-website).
