# Firebase Authentication — Mobile Integration Guide (Android & iOS)

This guide is for the Android and iOS developers. It explains how authentication works end-to-end and exactly what the mobile apps need to do.

---

## How It Works

The backend never talks to Firebase directly on behalf of the user. Instead, the mobile app authenticates with Firebase, gets a short-lived **ID Token**, and exchanges it with the backend for a **local JWT** that is used for all subsequent API calls.

```
Mobile App                                  Backend
──────────                                  ───────

1. User signs in via Firebase SDK
   (Email/Password, Google, Phone OTP, Apple)
              │
              │  Firebase ID Token (valid 1 hr)
              ▼
2. POST /firebase-auth/authenticate
   { "idToken": "eyJhbGci..." }  ──────────► Verify token with Firebase Admin SDK
                                                      │
                                             Find user by firebase_uid
                                             or email/phone — create if new
                                                      │
                                             Issue local JWT (15 min)
                                             + refresh token (7 days)
              │◄──────────────────────────────────────
3. Receive { access_token, refresh_token, user }
              │
              │  Store tokens securely
              ▼
4. All API calls use:
   Authorization: Bearer <access_token>
              │
              │  access_token expires after 15 min
              ▼
5. POST /auth/refresh
   { "refresh_token": "..." }    ──────────► Issue new access_token + new refresh_token
              │◄──────────────────────────────────────
   New { access_token, refresh_token }
```

> The backend automatically creates a new user account on first login. If a user already exists with the same email or phone, their account is linked to the Firebase UID.

---

## Project Setup

### Step 1 — Add the Firebase config files

Download these from the [Firebase Console](https://console.firebase.google.com) under **Project Settings > Your apps** and place them in your project:

| Platform | File | Location |
|---|---|---|
| Android | `google-services.json` | `app/` directory |
| iOS | `GoogleService-Info.plist` | Root of the Xcode project |

> If the project was previously connected to a different Firebase project, replace the old file with the new one.

### Step 2 — Enable sign-in methods in Firebase Console

Go to **Build > Authentication > Sign-in method** and enable whichever methods your app uses (Email/Password, Google, Phone, Apple).

---

## The Exchange Request

Every sign-in method ends with the same single API call:

**`POST /firebase-auth/authenticate`**

```json
// Request body
{
  "idToken": "<Firebase ID Token from the SDK>"
}
```

```json
// Success response (200)
{
  "access_token": "eyJhbGci...",
  "refresh_token": "a3f9c2...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "user",
    "is_onboarded": false
  }
}
```

Store `access_token` in memory and `refresh_token` in secure storage (Keystore on Android, Keychain on iOS).

---

## Android (Kotlin)

### Email & Password Sign-In

```kotlin
FirebaseAuth.getInstance()
    .signInWithEmailAndPassword(email, password)
    .addOnSuccessListener { result ->
        result.user?.getIdToken(false)
            ?.addOnSuccessListener { tokenResult ->
                exchangeForLocalJWT(tokenResult.token!!)
            }
    }
    .addOnFailureListener { e ->
        // handle Firebase sign-in error
    }
```

### Google Sign-In

```kotlin
// 1. Launch Google sign-in intent, get the GoogleSignInAccount
// 2. Exchange the account for a Firebase credential
val credential = GoogleAuthProvider.getCredential(googleAccount.idToken, null)

FirebaseAuth.getInstance().signInWithCredential(credential)
    .addOnSuccessListener { result ->
        result.user?.getIdToken(false)
            ?.addOnSuccessListener { tokenResult ->
                exchangeForLocalJWT(tokenResult.token!!)
            }
    }
```

### Phone (OTP)

```kotlin
// Step 1 — Send OTP
val options = PhoneAuthOptions.newBuilder(FirebaseAuth.getInstance())
    .setPhoneNumber(phoneNumber) // E.164 format e.g. +233575557050
    .setTimeout(60L, TimeUnit.SECONDS)
    .setActivity(this)
    .setCallbacks(callbacks)
    .build()
PhoneAuthProvider.verifyPhoneNumber(options)

// Step 2 — Verify OTP and sign in
val credential = PhoneAuthProvider.getCredential(verificationId, otpCode)
FirebaseAuth.getInstance().signInWithCredential(credential)
    .addOnSuccessListener { result ->
        result.user?.getIdToken(false)
            ?.addOnSuccessListener { tokenResult ->
                exchangeForLocalJWT(tokenResult.token!!)
            }
    }
```

### The Exchange Function

```kotlin
suspend fun exchangeForLocalJWT(idToken: String): AuthResponse {
    val response = apiService.firebaseAuthenticate(FirebaseAuthRequest(idToken = idToken))
    // Save tokens
    secureStorage.save("access_token", response.accessToken)
    secureStorage.save("refresh_token", response.refreshToken)
    return response
}
```

---

## iOS (Swift)

### Email & Password Sign-In

```swift
Auth.auth().signIn(withEmail: email, password: password) { result, error in
    guard let user = result?.user, error == nil else { return }
    user.getIDToken { idToken, error in
        guard let idToken = idToken, error == nil else { return }
        exchangeForLocalJWT(idToken: idToken)
    }
}
```

### Google Sign-In

```swift
// After GIDSignIn.sharedInstance.signIn(...) succeeds:
guard let idToken = user.idToken?.tokenString else { return }
let credential = GoogleAuthProvider.credential(withIDToken: idToken,
                                               accessToken: user.accessToken.tokenString)
Auth.auth().signIn(with: credential) { result, error in
    guard let firebaseUser = result?.user, error == nil else { return }
    firebaseUser.getIDToken { idToken, error in
        guard let idToken = idToken, error == nil else { return }
        exchangeForLocalJWT(idToken: idToken)
    }
}
```

### Phone (OTP)

```swift
// Step 1 — Send OTP
PhoneAuthProvider.provider().verifyPhoneNumber(phoneNumber, uiDelegate: nil) { verificationID, error in
    // Save verificationID for step 2
}

// Step 2 — Verify OTP and sign in
let credential = PhoneAuthProvider.provider().credential(
    withVerificationID: verificationID,
    verificationCode: otpCode
)
Auth.auth().signIn(with: credential) { result, error in
    guard let user = result?.user, error == nil else { return }
    user.getIDToken { idToken, error in
        guard let idToken = idToken, error == nil else { return }
        exchangeForLocalJWT(idToken: idToken)
    }
}
```

### The Exchange Function

```swift
func exchangeForLocalJWT(idToken: String) {
    let body = ["idToken": idToken]
    // POST to /firebase-auth/authenticate
    APIClient.shared.post("/firebase-auth/authenticate", body: body) { response in
        KeychainHelper.save(response.accessToken, forKey: "access_token")
        KeychainHelper.save(response.refreshToken, forKey: "refresh_token")
    }
}
```

---

## Making Authenticated API Calls

Attach the `access_token` as a Bearer token on every request:

```
Authorization: Bearer <access_token>
```

---

## Optional Auth Status (Browse First)

Use this when the app allows anonymous browsing and only requires auth on interaction.

### Check Auth Status

If no token is present, the response is `{ authenticated: false }`.

```json
GET /auth/status
Authorization: Bearer <access_token>  // optional

// Response
{ "authenticated": false }
// or { "authenticated": true, "is_onboarded": true, "user": { ... } }
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

```json
POST /auth/firebase-login
{ "idToken": "<Firebase ID Token>" }
```

---

## Token Refresh

The `access_token` expires in **15 minutes**. When you get a `401` response, use the `refresh_token` to get a new one.

**`POST /auth/refresh`**

```json
// Request body
{
  "refresh_token": "<stored refresh token>"
}
```

```json
// Success response (200)
{
  "access_token": "eyJhbGci...",
  "refresh_token": "b7d1e3..."
}
```

> The backend rotates the refresh token on every use — always replace the stored one with the new value. The refresh token expires after **7 days**, after which the user must sign in again.

---

## FCM Push Notifications

After a successful login, send the device's FCM token to the backend so it can send push notifications.

**`PATCH /users/fcm-token`**

```json
// Request body
{
  "fcm_token": "<device FCM token from Firebase SDK>"
}
```

```
Authorization: Bearer <access_token>
```

Refresh and re-send the FCM token whenever `FirebaseMessaging.getInstance().token` provides a new one (the SDK calls `onNewToken` when this happens).

---

## Error Reference

| HTTP Status | Meaning | What to do |
|---|---|---|
| `401 Unauthorized` | `idToken` is invalid or expired | Call `getIdToken(true)` to force-refresh and retry |
| `400 Bad Request` | Missing or malformed request body | Check the request payload |
| `404 Not Found` | Email not found (email utility endpoints only) | Show appropriate message to user |

---

## Summary Checklist

- [ ] Replace `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) with files from the new Firebase project
- [ ] Enable required sign-in methods in the Firebase Console
- [ ] After any Firebase sign-in, call `getIdToken()` and `POST /firebase-auth/authenticate`
- [ ] Store `access_token` in memory, `refresh_token` in secure storage (Keystore / Keychain)
- [ ] Attach `Authorization: Bearer <access_token>` to all API requests
- [ ] On `401`, call `POST /auth/refresh` to get a new token pair
- [ ] After login, send the FCM device token via `PATCH /users/fcm-token`
