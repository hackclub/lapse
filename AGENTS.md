This is a repository for Lapse - a web app for tracking time spent on personal projects by recording timelapses. We use TypeScript, Next.js, Fastify, Prisma ORM, Tailwind CSS, and BullMQ for our tech stack.

This project features the following packages:
- `apps/client`: a frontend built with Next.js, interfacing with the server via the `api` package.
- `apps/server`: the main Fastify/oRPC backend for Lapse.
- `apps/worker`: a BullMQ worker that encodes legacy draft timelapses on publish. Interfaces with `server`.
- `apps/devscripts`: scripts for local development, like setting up a dev environment.
- `packages/api`: contracts shared between `client` and `server`. This package also allows for third-party clients to be developed for Lapse.
- `packages/jobs`: BullMQ job contracts shared between `server` and `worker`.
- `packages/shared`: utilities shared between unrelated packages.
- `vendor/lookout`: a git submodule of Lookout, a separate Hack Club project. Its `packages/shared`, `packages/wasm` (`@lookout/wasm`, the Rust recorder engine compiled to WebAssembly - build it with `etc/build-lookout-wasm.sh`) and `clients/react` (`@lookout/react`) are part of this workspace. `client.Dockerfile` and `etc/fetch-lookout.sh` (used by Vercel) pin the same Lookout commit as the submodule - keep all three in step.

Database models are defined in @apps/server/prisma/schema.prisma.
API contracts are defined in @packages/api/src/contracts.
Server endpoints are implemented in @apps/server/src/routers.

All recording goes through Lookout, a screen recording timelapse service. Lapse never handles the recorded frames itself: the server creates a Lookout session (`timelapse.createRecordingSession`) along with a `DraftLookoutTimelapse`, and the user records either in the browser via `@lookout/react` or in the Lookout desktop app. Lookout stores the screenshots and compiles the video. See @vendor/lookout/docs/integration.md.

A user can choose to publish a draft, creating a `Timelapse` as a result. For Lookout drafts, this stores Lookout's video and thumbnail URLs on the timelapse - nothing is transcoded by Lapse. Published timelapses are not encrypted and may be viewed by any other user.

Publishing doesn't require a compiled video. The user's answers (name, description, visibility, Hackatime project) are stored as a pending intent on the draft (`pending*` columns), and the `Timelapse` is created once Lookout reports the session as complete - by whichever of `pollLookoutStatus`, `getLookoutDrafts`, or a background sweeper notices first. The Lookout desktop app can also pair with Lapse, start recordings, and show the publish form in its own panel without a browser round-trip. See @apps/server/src/lookoutPublish.ts and @docs/lookout-desktop.md.

Lookout drafts are never deleted except by publishing: discarding one (or Lapse failing to find its Lookout session) only sets `archivedAt`, and the user can restore it from `/timelapse/archive`. Archived drafts are hidden from the drafts list and the sweeper. The desktop publish panel still opens for them, and answering it restores the draft. Change a draft's state through @apps/server/src/lookoutDraftEvents.ts, which records every change in `LookoutDraftEvent` - server logs don't last long enough to explain a missing recording.

`DraftTimelapse` and `LegacyUnpublishedTimelapse` are left over from the pre-Lookout recorder, which encrypted videos on the client with a per-device key. New ones can't be created - `draftTimelapse.create` and `timelapse.publish` only accept recordings made before the cutoff - and they exist only so users can recover and publish old recordings (@apps/client/src/legacyRecovery.ts). Publishing one sends the device key to the `worker`, which decrypts the sessions, applies the edit list and encodes the video. Don't build new features on this path.

Lapse has the ability to import data to an API-compatible WakaTime fork called Hackatime. When importing, a WakaTime heartbeat will be created for each *snapshot*. For Lookout recordings, snapshots are the screenshot timestamps returned by Lookout's timings endpoint.

Loading states in the client use Skullet (https://skullet.lochie.me/docs). Wrap the real component in `<Skeleton data={x} sample={SAMPLE_X}>` from `skullet/react` rather than drawing grey boxes by hand - Skullet renders the sample unseen and traces it into the skeleton. Samples live in @apps/client/src/samples.ts. Use `loading` with plain children when there is no data object (e.g. the signed-in state), an `id` where the shape should be remembered across visits, and `<SkeletonBox>` only for things that don't measure (the video band, an avatar with no user). Theme and reveal are set once by `SkulletProvider` in `_app.tsx`, and `forgetShapes()` runs on sign-out.

Loading states in the client use Skullet (https://skullet.lochie.me/docs). Wrap the real component in `<Skeleton data={x} sample={SAMPLE_X}>` from `skullet/react` rather than drawing grey boxes by hand - Skullet renders the sample unseen and traces it into the skeleton. Samples live in @apps/client/src/samples.ts. Use `loading` with plain children when there is no data object (e.g. the signed-in state), an `id` where the shape should be remembered across visits, and `<SkeletonBox>` only for things that don't measure (the video band, an avatar with no user). Theme and reveal are set once by `SkulletProvider` in `_app.tsx`, and `forgetShapes()` runs on sign-out.

Columns that would let their reader act as somebody else (Hackatime tokens, Lookout tokens, panel tokens, and the hashes of device tokens, client secrets and program keys) are listed in @apps/server/src/secrets.ts, and the database client leaves them out of every result. Use the types from that file (`safe.User`, `safe.Timelapse`, ...) rather than `db.User`, and when code really needs a secret, ask for it by name with `omit: { column: false }` or a `select`. A new column of this kind goes on that list - `pnpm --filter @hackclub/lapse-server test` fails otherwise.

The website's session is a cookie its scripts can't read (@apps/server/src/session.ts, @apps/client/src/session.ts), which the server only honours for requests whose `Origin` is the website. Bearer tokens are for everything else: third-party apps, the mobile app, the Lookout desktop app, program keys. Don't put a token back into `localStorage`, and don't add an endpoint that returns one to the website. Administrator powers additionally need a sign-in within the last hour.

Who may call a procedure is declared in @apps/server/src/policies.ts and enforced by `authorize` (@apps/server/src/policy.ts), which every procedure starts with: `os.update.use(authorize("timelapse.update"))`. Handlers don't check permissions themselves - no comparing `permissionLevel`, no "is this the owner" - so a new rule goes in the policy, and a new procedure needs a policy (it won't compile otherwise) and an entry in `test/authorization.test.ts`. Where a handler decides what to *show* rather than whether to allow, it asks `actorEntitledTo` or `isAdmin` from @apps/server/src/ownership.ts. See @docs/authentication.md.

# Code style

- Avoid braces for if/else blocks that return or throw.
- Use 4 spaces as indentation for TypeScript files.
- Avoid creating comments for self-documenting code.

Put `catch` and `else` blocks on their own line. For example:
```
try {
    // ...
}
catch {
    // ...
}

if (...) {

}
else if (...) {

}
else {

}
```

# Rules

- Avoid using the `any` type.
- All code should be strongly typed.
- Do not run linters. You may verify the code style with oxlint (`pnpm lint`), but do not run code formatters (oxfmt).
- Do not attempt to preview the site or run the server by yourself.
