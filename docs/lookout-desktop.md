# The Lookout desktop app

Lookout is the recording backend behind Lapse's desktop experience. Lapse creates the session; Lookout's
desktop app records it, compiles it, and hands the result back. This document covers the three places
where the app reaches into Lapse directly, all added on top of the original browser handoff and none of
them replacing it.

If you only want the original flow, nothing here applies: `/timelapse/create` still mints a session and
pushes into `lookout://session?token=…`, and `/timelapse/handoff/:draftId` is still where Lookout's
redirect hook lands. Everything below is what happens when the *app* starts the conversation.

## Configuration

Lookout keeps a registry of the programs its desktop app can start a recording for. Lapse's row needs
these set (by a Lookout admin, in Lookout's own admin dashboard):

| Field | Value |
|---|---|
| `newSessionUrl` | `https://lapse.hackclub.com/timelapse/create?desktop=true` |
| `pairUrl` | `https://api.lapse.hackclub.com/lookout/pair` |
| `startUrl` | `https://api.lapse.hackclub.com/lookout/start` |
| `displayName` | `Lapse` |
| `iconUrl` | a small square logo |

`pairUrl` and `startUrl` point at the **API**, not the web app, because Lookout talks to them as a
program rather than as a browser — see [`lookoutDesktop.ts`](/apps/server/src/lookoutDesktop.ts). The one
exception is a plain `GET /lookout/pair`, which is a browser visit and redirects to the consent page on
the web app.

`displayName` is what the app's UI says: "Open in Lapse", "Starting Lapse…", "Lapse needs a few
details". Leave it unset and every one of those reads `lapse`.

## Device pairing, and starting without a browser

Picking Lapse from the desktop app's `+` menu used to open `/timelapse/create?desktop=true`, which
created a session and immediately bounced back into `lookout://` — a browser flash where nothing was
shown. That hop is doing identity work, and identity work is needed once per device, not once per
recording.

1. The app opens `GET /lookout/pair?challenge=…&state=…&device=…`, which redirects to
   `/lookout/pair` on the web app.
2. That page authenticates the user normally (it is an ordinary page with an ordinary session) and, on
   approval, calls `timelapse.approveDesktopPairing` for a single-use code, then redirects to
   `lookout://pair?code=…&state=…`.
3. The app exchanges the code: `POST /lookout/pair` with `{ code, verifier }` → `{ deviceToken }`.
4. Every recording after that is one call: `POST /lookout/start` with
   `Authorization: Bearer <deviceToken>` → `{ sessionToken }`. No browser.

The code is worthless on its own. Redeeming it requires the PKCE verifier behind `challenge`, which
never leaves the app — which matters because a `lookout://` link travels through OS plumbing that any
installed program could have registered. Codes expire in five minutes and are burned on first use,
successful or not.

Device tokens are stored **hashed** (`LookoutDevice.tokenHash`); the plaintext exists only in the app's
own credential store. A token authorizes exactly one thing — create a Lookout session for this user —
and nothing else on the account. Revoke from either end: `timelapse.revokeDesktopDevice` on our side,
or `DELETE /lookout/pair` with the bearer token, which is what the app's own unlink calls.

## The publish panel, and why publishing came apart

The app renders our publish flow in a sheet instead of opening a browser tab. `panelUrl` is set at
session creation to `/lookout/panel/<panelToken>`, and the page is
[`[panelToken].tsx`](/apps/client/src/pages/lookout/panel/[panelToken].tsx).

Two constraints shape it, and both are load-bearing:

**It has no session.** A third-party iframe receives none of our cookies — WebKit and WebView2 both
partition them — so nothing in the panel can call an authenticated procedure. `panelToken` is the
credential, and it is 256 bits of randomness for exactly that reason. The panel's endpoints
(`GET/POST /lookout/panel/:panelToken`, and `…/hackatime-projects`) accept it and nothing else. This is
also why `HackatimeProjectPicker` grew a `loadProjects` prop: the panel cannot reach
`hackatime.allProjects`.

**It has no video.** Lookout opens the panel as soon as the recording is *saved*, minutes before the
compile finishes, so that nobody has to watch a progress bar before naming their timelapse. Our publish
flow previously required the opposite — the form only rendered once Lookout said `complete`, and
`publishFromLookout` hard-rejected anything else — because publishing and *producing* the timelapse were
the same step.

So they came apart, in [`lookoutPublish.ts`](/apps/server/src/lookoutPublish.ts):

1. **The intent** — name, description, visibility, Hackatime project — is stored on the draft
   (`pending*` columns). Needs no video.
2. **The `Timelapse`** is created once Lookout has one to attach. Needs no user.

Whoever notices the session is ready does step 2: `pollLookoutStatus`, the login-time `getLookoutDrafts`
sweep, or a one-minute interval sweeper for when nobody is looking at all. Lookout has no webhook, so we
look. The insert is idempotent — `Timelapse.lookoutSessionId` is unique, so two sweeps racing means one
loses an insert, not two timelapses — and the sweeper takes a Redis lock so replicas don't all poll
Lookout for the same thing.

`publishFromLookout` now goes through the same two steps, so a timelapse published from the website and
one published from the app cannot drift apart.

### Things a panel must not assume

- **No `videoUrl`.** The session is usually `compiling`. Don't preview the video, don't gate the form on
  it. `trackedSeconds`, `/timings` and the name are all available immediately.
- **Dismissal is free.** Closing the sheet stores nothing and loses nothing; the app keeps offering it as
  a card on the session page. That is why the panel's secondary button says "Not now" rather than
  "Discard" — discarding is a different, destructive action and lives on the website.
- **It gets reopened.** The same URL is loaded again from that card, so the panel checks `submitted` on
  load and closes itself immediately rather than asking twice.

### Telling Lookout we are done

`storePublishIntent` calls Lookout's `panel-resolved` endpoint as soon as the answers are in — *not*
after the video lands. From the user's point of view they are finished, and a card asking again for
details they already gave would be a lie. The user may equally have answered on our website instead,
which the desktop app cannot see; the same call covers that.

Once a `Timelapse` exists, `finalizeLookoutDraft` sets Lookout's `view-url` to its page, which is what
the app's "Open in Lapse ↗" action opens.

## Schema

| Model / column | Why |
|---|---|
| `LookoutDevice` | A paired install. `tokenHash` only. |
| `LookoutPairingCode` | Bridges consent page → app. Single-use, five-minute TTL. |
| `DraftLookoutTimelapse.panelToken` | The panel's only credential. |
| `DraftLookoutTimelapse.pending*` | The user's answers, held until there is a video. |

Migration: `20260824150000_lookout_desktop_handoff`.
