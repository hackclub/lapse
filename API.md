# Lapse REST API Documentation

Thank you for wanting to integrate Lapse with your creation! <3

This document provides guidance on how to integrate Lapse into external services and applications.

## Overview

The most valuable resource in your journey of integrating Lapse will be the [**Swagger UI docs**](https://api.lapse.hackclub.com/docs). These are automatically generated from the source code.

The main REST API is available at `https://api.lapse.hackclub.com/api` (or your self-hosted instance).

Every single response by the API is in JSON, and **always** has the shape of either:
```json
// All good!
{ "ok": true, "data": { ... } }

// Something went wrong...
{ "ok": false, "error": "ERROR", "message": "Human readable error message goes here!" }
```

You can find a list of all `"error"` values in `KnownError` in [src/shared/common.ts](https://github.com/hackclub/lapse/blob/a15a4152002db25f0040ae4bebb0283a7dd92df6/apps/web/src/shared/common.ts#L42-L54).

Lapse has two kinds of endpoints: **public** and **protected** ones. **Public** endpoints don't require authentication, but *may* be augmented by it. For example, when querying the timelapses made by a user, if that user is logged in, unlisted timelapses will also be included.

For example - `global/weeklyLeaderboard` is a public endpoint:

```
GET /api/global/weeklyLeaderboard
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "leaderboard": [
      {
        "id": "uuid",
        "handle": "username",
        "displayName": "User Name",
        "pfp": "https://...",
        "secondsThisWeek": 3600
      }
    ]
  }
}
```

...but for protected endpoints, you'll need...

## OAuth Authentication

OAuth allows third-party applications to access Lapse on behalf of users. The OAuth flow is implemented using the Authorization Code flow with JWT tokens.

### Overview

The OAuth authentication process involves three main steps:

1. **User Authorization**: Your application directs the user to authorize access on Lapse
2. **Authorization Approval**: The user reviews what data your app is requesting and approves
3. **Token Exchange**: Your backend exchanges the authorization for an access token

### Getting Started with OAuth

To use OAuth, you need to:

1. Register your application with a Lapse administrator to receive a `client_id`
2. Provide redirect URIs where users will be sent after authorization
3. Keep your `client_secret` secure and never expose it in client-side code

### Step 1: Initiate Authorization

Direct the user to the authorization endpoint:

```
POST /api/oauth/authorize
```

**Request Body:**
```json
{
  "client_id": "your_client_id",
  "redirect_uri": "https://yourapp.com/callback",
  "scope": ["timelapse:read", "user:read"],
  "state": "optional_random_string"
}
```

**Parameters:**
- `client_id` (string, required): Your OAuth client ID
- `redirect_uri` (string, required): Where to redirect after authorization (must be registered with Lapse)
- `scope` (array, optional): Array of scopes your app needs (see [Available Scopes](#available-scopes))
- `state` (string, optional): A random string to prevent CSRF attacks

**Response (First Time):**

If this is the first time the user is authorizing your app, the response will contain the client details and request the user to approve:

```json
{
  "ok": true,
  "data": {
    "client": {
      "id": "client_uuid",
      "name": "My Application",
      "clientId": "your_client_id",
      "scopes": ["timelapse:read", "timelapse:write", "user:read"],
      "redirectUris": ["https://yourapp.com/callback"],
      "trustLevel": "LOW"
    }
  }
}
```

**Response (Already Authorized):**

If the user has already authorized this app previously, they will be automatically redirected:

```json
{
  "ok": true,
  "data": {
    "redirectUrl": "https://yourapp.com/callback#access_token=jwt_token&token_type=Bearer&expires_in=900&scope=timelapse%3Aread+user%3Aread&state=...",
    "accessToken": "jwt_token",
    "grantId": "grant_uuid"
  }
}
```

### Step 2: User Approves/Denies Access

If the first authorization response contained client details, present them to the user. Ask the user to approve or deny access.

Once the user has made a decision, submit their choice:

```
PUT /api/oauth/authorize
```

**Request Body:**
```json
{
  "client_id": "your_client_id",
  "redirect_uri": "https://yourapp.com/callback",
  "scope": ["timelapse:read", "user:read"],
  "state": "optional_random_string",
  "consent": true
}
```

**Parameters:**
- Same as POST request, plus:
- `consent` (boolean, required): Whether the user approved or denied access

**Response (Approved):**

```json
{
  "ok": true,
  "data": {
    "redirectUrl": "https://yourapp.com/callback#access_token=jwt_token&token_type=Bearer&expires_in=900&scope=timelapse%3Aread+user%3Aread&state=...",
    "accessToken": "jwt_token",
    "grantId": "grant_uuid"
  }
}
```

**Response (Denied):**

```json
{
  "ok": true,
  "data": {
    "redirectUrl": "https://yourapp.com/callback#error=access_denied&state=..."
  }
}
```

### Step 3: Handle the Callback

After authorization, the user's browser will be redirected to your `redirect_uri` with the access token in the URL fragment (hash). Your frontend should extract the token and send it to your backend.

The URL will look like:
```
https://yourapp.com/callback#access_token=eyJhbGc...&token_type=Bearer&expires_in=900&scope=timelapse%3Aread+user%3Aread&state=abc123
```

Extract these parameters:
- `access_token`: The JWT token to use for API requests
- `token_type`: Always "Bearer"
- `expires_in`: Token lifetime in seconds (900 = 15 minutes)
- `scope`: Space-separated list of granted scopes
- `state`: The state parameter you sent (verify it matches to prevent CSRF)

### Available Scopes

Scopes determine what permissions your app has. Users can approve or reject each scope. Always request the minimum scopes your application needs.

| Scope | Description |
|-------|-------------|
| `timelapse:read` | View the user's timelapses |
| `timelapse:write` | Create and update the user's timelapses |
| `snapshot:read` | View timelapse snapshots (frames) |
| `snapshot:write` | Delete timelapse snapshots |
| `comment:write` | Create and delete comments |
| `user:read` | Read the user's profile information |
| `user:write` | Update the user's profile information |

### Example OAuth Flow (JavaScript)

```javascript
// Step 1: Initiate authorization
async function startOAuth() {
  const state = generateRandomString(32);
  localStorage.setItem("oauth_state", state);
  
  const response = await fetch("https://api.lapse.hackclub.com/api/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "your_client_id",
      redirect_uri: "https://yourapp.com/callback",
      scope: ["timelapse:read", "user:read"],
      state: state
    })
  });
  
  const data = await response.json();
  
  if (data.data.redirectUrl) {
    // Already authorized, redirect directly
    window.location.href = data.data.redirectUrl;
  } else {
    // First time, show consent screen
    displayConsentScreen(data.data.client, state);
  }
}

// Step 2: User approves, submit consent
async function approveOAuth(state) {
  const response = await fetch("https://api.lapse.hackclub.com/api/oauth/authorize", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "your_client_id",
      redirect_uri: "https://yourapp.com/callback",
      scope: ["timelapse:read", "user:read"],
      state: state,
      consent: true
    })
  });
  
  const data = await response.json();
  window.location.href = data.data.redirectUrl;
}

// Step 3: Handle callback
function handleCallback() {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  
  const token = params.get("access_token");
  const state = params.get("state");
  
  // Verify state
  if (state !== localStorage.getItem("oauth_state")) {
    console.error("State mismatch! Possible CSRF attack.");
    return;
  }
  
  // Send token to your backend
  fetch("https://yourapp.com/api/auth/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
}
```
