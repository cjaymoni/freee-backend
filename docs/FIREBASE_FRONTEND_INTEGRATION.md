# Firebase Authentication — Frontend Integration Guide

This guide covers every auth flow supported by the backend. The core pattern is always the same: **authenticate with Firebase → get an `idToken` → exchange it for a local JWT**.

---

## Setup

### 1. Install Firebase SDK

```bash
npm install firebase
```

### 2. Initialize Firebase

```ts
// lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  storageBucket: '...',
  messagingSenderId: '...',
  appId: '...',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
```

### 3. Store Your Tokens

After a successful exchange, store the tokens from the backend response:

```ts
// The backend returns this shape from POST /firebase-auth/authenticate
{
  access_token: string;   // JWT — short-lived (15 min), use for all API calls
  refresh_token: string;  // long-lived (7 days), use to get a new access_token
  user: {
    id: string;
    email: string;
    role: string;
    is_onboarded: boolean;
  };
}
```

Store `access_token` in memory and `refresh_token` in a secure, persistent store (e.g. `localStorage` or a secure cookie).

---

## The Exchange Function

All auth methods below funnel into this single function:

```ts
// lib/auth.ts
async function exchangeForLocalJWT(idToken: string) {
  const res = await fetch('http://localhost:3000/firebase-auth/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message);
  }

  const data = await res.json();
  // persist tokens
  localStorage.setItem('refresh_token', data.refresh_token);
  return data; // { access_token, refresh_token, user }
}
```

---

## Auth Methods

### Google Sign-In

```ts
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  return exchangeForLocalJWT(idToken);
}
```

---

### Email & Password — Sign Up

```ts
import { createUserWithEmailAndPassword } from 'firebase/auth';

async function signUp(email: string, password: string) {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  const idToken = await result.user.getIdToken();
  return exchangeForLocalJWT(idToken);
}
```

> After sign-up, call `POST /firebase-auth/send-verification-email` to trigger a verification email (see below).

---

### Email & Password — Sign In

```ts
import { signInWithEmailAndPassword } from 'firebase/auth';

async function signIn(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  const idToken = await result.user.getIdToken();
  return exchangeForLocalJWT(idToken);
}
```

---

### Phone (OTP) — Step 1: Send SMS

```ts
import { signInWithPhoneNumber, RecaptchaVerifier } from 'firebase/auth';

// Call once on the page that has the phone input
const recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
  size: 'normal',
});

async function sendOtp(phoneNumber: string) {
  // phoneNumber must be in E.164 format e.g. +233575557050
  const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
  return confirmationResult; // store this to verify the code in step 2
}
```

### Phone (OTP) — Step 2: Verify Code

```ts
async function verifyOtp(confirmationResult: ConfirmationResult, code: string) {
  const result = await confirmationResult.confirm(code);
  const idToken = await result.user.getIdToken();
  return exchangeForLocalJWT(idToken);
}
```

---

## Email Utility Endpoints

These hit the backend directly — no Firebase SDK call needed.

### Send Verification Email

```ts
// Call after sign-up or when user requests a resend
async function sendVerificationEmail(email: string) {
  const res = await fetch('http://localhost:3000/firebase-auth/send-verification-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return res.json(); // { message: 'Verification email sent successfully' }
}
```

### Send Password Reset Email

```ts
async function sendPasswordResetEmail(email: string) {
  const res = await fetch('http://localhost:3000/firebase-auth/send-password-reset-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return res.json(); // { message: 'Password reset email sent successfully' }
}
```

### Send Passwordless Sign-In Link

```ts
async function sendSignInLink(email: string) {
  const res = await fetch('http://localhost:3000/firebase-auth/send-signin-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return res.json(); // { message: 'Sign-in link sent successfully' }
}
```

### Revoke All Sessions (Sign Out Everywhere)

```ts
async function revokeAllSessions(email: string, accessToken: string) {
  const res = await fetch('http://localhost:3000/firebase-auth/revoke-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ email }),
  });
  return res.json(); // { message: 'All active sessions have been signed out' }
}
```

---

## Using the Local JWT

Once you have the `access_token`, attach it to every protected API request:

```ts
async function apiFetch(path: string, options: RequestInit = {}) {
  const accessToken = /* retrieve from memory */;
  return fetch(`http://localhost:3000${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
}
```

---

## Optional Auth Status (Browse First)

Use this when the UI allows anonymous browsing and only requires auth on interaction.

### Check Auth Status

If no token is present, the response is `{ authenticated: false }`.

```ts
async function getAuthStatus(accessToken?: string) {
  const res = await fetch('http://localhost:3000/auth/status', {
    method: 'GET',
    headers: accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined,
  });

  return res.json();
  // { authenticated: false }
  // or { authenticated: true, is_onboarded: boolean, user: {...} }
}
```

### Interaction Gate (Suggested Flow)

1. Allow anonymous browsing.
2. On item interaction:
   - If no token, sign in via Firebase, then exchange `idToken` for JWT.
   - Call `GET /auth/status`.
   - If `is_onboarded` is false, route to onboarding.
   - Otherwise proceed with the action.

### Firebase Login Alias

This is equivalent to `POST /firebase-auth/authenticate` but shorter:

```ts
async function exchangeWithAlias(idToken: string) {
  const res = await fetch('http://localhost:3000/auth/firebase-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  return res.json();
}
```

---

## Token Refresh

The `access_token` expires in **15 minutes**. Use the `refresh_token` to get a new one:

```ts
async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refresh_token');
  const res = await fetch('http://localhost:3000/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    // refresh_token expired (7 days) — send user back to login
    localStorage.removeItem('refresh_token');
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json(); // { access_token, refresh_token }
  localStorage.setItem('refresh_token', data.refresh_token); // token rotation
  return data.access_token;
}
```

> The backend rotates the refresh token on every use — always save the new one.

---

## Complete Auth Flow Summary

```
User action
    │
    ▼
Firebase SDK  ──────────────────────────────────────────────────────────┐
(Google / Email+Password / Phone OTP)                                   │
    │                                                                    │
    │  idToken                                                           │
    ▼                                                                    │
POST /firebase-auth/authenticate                                         │
    │                                                                    │
    │  { access_token, refresh_token, user }                             │
    ▼                                                                    │
Store tokens                                                             │
    │                                                                    │
    ▼                                                                    │
Call protected API endpoints with Bearer access_token                   │
    │                                                                    │
    │  401 (token expired after 15 min)                                  │
    ▼                                                                    │
POST /auth/refresh  →  new access_token + new refresh_token ────────────┘
```

---

## Error Reference

| HTTP Status | Meaning |
|---|---|
| `401 Unauthorized` | Firebase `idToken` is invalid or expired — re-authenticate |
| `400 Bad Request` | Missing/invalid request body field |
| `404 Not Found` | Email not found in the system (verification/revoke endpoints) |
| `409 Conflict` | User already exists (standard register flow only) |
