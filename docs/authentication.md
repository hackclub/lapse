# Authenticating users to Lapse
The Lapse backend (`api.lapse.hackclub.com`) serves as an **identity broker** between Hackatime and Lapse clients.

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
    - The canonical client, upon receiving consent, redirects to `/auth/continue`, with an `consentToken` provided. As this endpoint requires said token, it is not possible to redirect to this endpoint without going through the consent modal.
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

## Who may call what
Every procedure has a policy, in [`policies.ts`](/apps/server/src/policies.ts), and nothing else decides who may call it - handlers don't check permissions themselves. A policy says whether the procedure is public, for users only, or for users and program keys; which scopes a third-party app needs; and, where it acts on something that belongs to somebody, who besides the owner may act on it. [`policy.ts`](/apps/server/src/policy.ts) enforces it before the handler runs.

Two rules hold everywhere, because they are enforced there rather than written into each policy:

- **Administrators are only administrators on the Lapse website.** The `ADMIN` and `ROOT` permission levels count for nothing without the `elevated` scope. If an admin signs into a third-party app, that app acts for them as an ordinary user: it can't read other people's drafts, edit their timelapses, look users up by e-mail, or reach the admin panel.
- **Program keys are administrators only as far as their scopes say.** A program key isn't a user and owns nothing. On top of the ordinary scopes above, it can hold:

| Scope         | Lets a program key...                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| `admin:read`  | read what belongs to any user, the way an administrator can (unlisted timelapses, drafts) |
| `admin:write` | change or delete what belongs to any user, the way an administrator can                 |
| `admin:panel` | use the admin panel's own procedures (`admin.*`, `developer.getAllApps`)                |

  The ordinary scope is still needed alongside: deleting somebody's timelapse takes `timelapse:write` and `admin:write`. Nothing lets a program key call a `ROOT`-only procedure, and `elevated` means nothing on one.

`pnpm --filter @hackclub/lapse-server test` calls every procedure as every kind of caller and compares the outcome with what `test/authorization.test.ts` says it should be, so a policy can't be loosened without that file changing too. The server also refuses to start if a procedure isn't guarded by its own policy.

