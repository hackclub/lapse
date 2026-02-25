# Authenticating users to Lapse
The Lapse hackend (api.lapse.hackclub.com) serves as an **identity broker** between Hackatime and Lapse clients.

We feature the following scopes:

| Scope             | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `timelapse:read`  | View the user's timelapses                                     |
| `timelapse:write` | Create and update the user's timelapses                        |
| `comment:write`   | Create and delete comments                                     |
| `user:read`       | Read the user's profile information                            |
| `user:write`      | Update the user's profile information                          |
| `elevated`        | Full access, alongside OAuth app management and admin features |

The `elevated` scope is of particular attention. This scope is equivalent to granting **all scopes** to the user, as well as allowing the app to:
- handle consent modals for other apps,
- call into `admin` API routes,
- being able to automatically authenticate without going through the regular consent modal.

As this scope is incredibly sensitive, only the app the client ID of which is set as the `OAUTH_CANONICAL_APP_CLIENT_ID` environment variable can receive it. For production, this is the `lapse.hackclub.com` app. See [Elevated authorization](#elevated-authorization) for details.

## Regular authorization
This is what you're looking for if you're developing a custom client for Lapse! The official (canonical) Lapse client follows these steps with some minor differences - see [Elevated authorization](#elevated-authorization) for more details.

1. Redirect the user to the `/auth/authorize` route of the API.
    - This will make the user log in via Hackatime (our OIDC provider) internally if not previously authenticated.
    - If needed, this opens a consent modal via the canonical (first-party, `lapse.hackclub.com`) client.
    - The canonical client, upon receiving consent, redirects to `/auth/continue`, with an `Authorization` header. As this endpoint requires authentication, it is not possible to redirect to this endpoint without going through the consent modal.
2. Receive the authorization code by handling the redirect from the API to `<CALLBACK URL>?code=AUTH_CODE&state=xyz`.
3. Exchange the short-lived authorization code for an access and refresh token by calling `/auth/token`.

## Elevated authorization
Elevated authorization is *only* available to the OAuth app that is marked as canonical via the `OAUTH_CANONICAL_APP_CLIENT_ID` environment variable. If you're developing a client to interface with the official Lapse API server, you probably shouldn't (and can't!) do this. If you're developing a custom client for a custom server, you can use these steps to implement the client that will handle consent modals and administrative features.

A canonical client must perform these stops to authorize with the API:
1. Redirect the user to the `/auth/authorize` route of the API with `scopes` being set to `elevated`. The app with the provided client ID **must** be marked as `canonical` on the API's side.
    - This will make the user log in via Hackatime (our OIDC provider) internally if not previously authenticated.
    - **No consent checks are made.** This is important, as this means that we must absolutely trust the callback URL with our code and state.
2. Receive the authorization code by handling the redirect from the API to `<CALLBACK URL>?code=AUTH_CODE&state=xyz`.
3. Exchange the short-lived authorization code for an access and refresh token by calling `/auth/token`.
