# Privacy requests (GDPR deletion and export)

Deletion and export requests are run from the Hack Club privacy hub at https://yeet.hackclub.com. The hub calls Lapse once with `dry_run: true`. A human reviews the result, and after approval the hub calls again for real.

| Endpoint | Does |
| --- | --- |
| `POST /api/privacy/delete` | Deletes everything belonging to the subject, or reports it on a dry run |
| `POST /api/privacy/export` | Reports what is held. Export delivery isn't specified yet, so it never changes anything |

Both are plain Fastify routes (`apps/server/src/privacy.ts`), registered ahead of the oRPC catch-all, so they don't go through OAuth.

## Authentication

Each call carries `Authorization: Bearer <token>`: an ES256 JWT signed by the hub. `apps/server/src/privacyToken.ts` verifies it against the hub's JWKS (`https://yeet.hackclub.com/.well-known/jwks.json`) with the existing `jsonwebtoken` dependency. It checks:

- the signature, `kid`, and `typ: JWT`
- `iss` is `hackclub-privacy` and `aud` is `lapse`
- `exp` and `iat`, with a lifetime of at most 300 seconds and 30 seconds of leeway
- the shape of `request_id`, `action`, `dry_run`, and `subject`

Keys are cached for 5 minutes and refetched when an unknown `kid` shows up, so key rotation on the hub needs no change here. Nothing needs configuring in production; `PRIVACY_JWKS_URL` only exists to point at a hub running locally.

Lapse acts only on the token's claims, never the request body. Each token's `jti` is accepted once and recorded in `PrivacyTokenUse`, which is pruned after a day. It lives in Postgres rather than Redis because an unavailable cache would make every token look replayed.

Responses:

- `200 {request_id, found, dry_run, deleted: {model: rows}, retained: [{type, count, reason}]}`. Once someone is deleted, later calls answer `found: false`.
- `401 {error}` for a bad token, `400 action_mismatch`, `409 replayed`
- `409 manual_review_required` when the account created program keys or reviewed OAuth apps. Those belong to staff and back integrations other people rely on, so a human decides what happens to them first.
- `503` when the hub's JWKS or S3 can't be reached. The hub retries these.

## Who is matched

Users whose `email` matches one of the subject's emails (case-insensitively) or whose `slackId` matches. Lapse doesn't store Hack Club identity IDs, so `identity_id` matches nothing here. Neither column is unique, so one subject can match several users; all of them are erased.

## What gets deleted

- **Database**, in one transaction, in the order the RESTRICT foreign keys need:
  - comments they wrote, and other people's comments on their timelapses
  - draft timelapses, legacy unpublished timelapses, and timelapses
  - known devices, Lookout drafts, Lookout devices, and pairing codes
  - OAuth grants and token audits
  - the user row
- **S3**, before the transaction, so a storage failure leaves the database untouched for the retry:
  - draft sessions and thumbnails, plus anything else under `timelapses/<userId>/` in the encrypted bucket (uploads that never became a draft, upload metadata)
  - legacy session and thumbnail keys
  - everything under `timelapses/<timelapseId>/` in the public bucket

A dry run performs the same deletion inside a transaction and rolls it back, so the counts the reviewer approves are the counts that get executed. S3 objects are listed but not touched.

## What is kept

| Kept | Why |
| --- | --- |
| OAuth apps they registered | Other people sign in with them. The creator is removed (`createdByUserId` becomes null) |
| Admin audit entries | The record of admin actions. Entries about their records have `changes` cleared, and entries they made lose the actor |
| Lookout recordings | Stored by Lookout, which has no delete API yet. Lapse's references are deleted |
| Hackatime heartbeats | Imported into their Hackatime account. The hub's Hackatime target deletes them |

## Not covered

- Sentry and console logs from before the deletion, which can include profile data.
- Completed `lapse-realize` jobs kept in Redis, whose data includes session URLs.
- A video that is mid-encode when the deletion runs: the worker's upload lands after the timelapse is gone and is left in the public bucket.
