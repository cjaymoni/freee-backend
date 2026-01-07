# Firebase Setup Guide

Follow these steps to create and configure a Firebase project for phone verification and push notifications.

## 1. Create a Firebase Project

1.  Go to the [Firebase Console](https://console.firebase.google.com/).
2.  Click **Add project** and follow the prompts to create a new project.
3.  (Optional) Disable Google Analytics if not needed.

## 2. Enable Authentication (Phone)

1.  In the left sidebar, click **Build > Authentication**.
2.  Click **Get Started**.
3.  Go to the **Sign-in method** tab.
4.  Select **Phone** and toggle **Enable**.
5.  Click **Save**.
6.  (Optional) Add test phone numbers and verification codes under "Phone numbers for testing".

## 3. Enable Firebase Cloud Messaging (FCM)

1.  In the left sidebar, click **Project Settings** (the gear icon).
2.  Go to the **Cloud Messaging** tab.
3.  Ensure the **Firebase Cloud Messaging API (V1)** is enabled.

## 4. Generate Service Account Key (for Backend)

1.  In **Project Settings**, go to the **Service accounts** tab.
2.  Select **Node.js** as the configuration option.
3.  Click **Generate new private key**.
4.  Confirm by clicking **Generate key**.
5.  A JSON file will download. **Security Warning: Do not commit this file to version control.**

## 5. Configure Backend Environment

Update your `.env` file with the contents of the JSON file or the path to it.

### Option A: Using JSON String (Recommended for Deployment)

1.  Open the downloaded JSON file.
2.  Minify it (remove whitespace/newlines).
3.  Add it to your `.env`:
    ```env
    FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"..."}'
    ```

### Option B: Using File Path (Recommended for Local Dev)

1.  Save the file locally (e.g., `firebase-service-account.json`).
2.  Add the path to your `.env`:
    ```env
    FIREBASE_SERVICE_ACCOUNT_PATH='/absolute/path/to/firebase-service-account.json'
    ```

## 6. Registered Apps (Mobile)

To get the `idToken` on the mobile side, you must register your app:

1.  In **Project Settings > General**, scroll down to **Your apps**.
2.  Click **Add app** (iOS or Android) and follow the instructions to download `GoogleService-Info.plist` or `google-services.json`.
