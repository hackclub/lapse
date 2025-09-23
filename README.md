# Hack Club Lapse
[**Lapse**](https://lapse.hackclub.com) is a place for Hack Clubbers to record and share timelapses. Integrates with [Hackatime](https://hackatime.hackclub.com)!

## Introduction
Lapse helps you track time for anything that Hackatime is incapable of tracking. You record a timelapse of you doing something, publish it, and register your time in Hackatime! It's also a place for you to share your timelapses with others.

Think of it like a fancy WakaTime plugin. Just as you can install WakaTime for VS Code, Lapse serves to be the WakaTime plugin for timelapses.

Before you publish your timelapses, they're encrypted on your end. That means that you (and only you!) can access them. That way, we can synchronize your progress with our servers, while still making it possible for you to censor or remove anything you wouldn't want other people to see.

We currently only officially support Hackatime. Sorry!

## Nerdy Details
Lapse captures timestamped snapshots of a video feed (e.g. a user's screen or camera). Snapshots are always synchronized with the server, _and_ encrypted client-side with a key derived from:
- the user's password (which is not stored on the server),
- the UUID of the timelapse.

Currently, the algorithm used to encrypt snapshots is the browser-provided implementation of AES-256. Users can censor and remove snapshots before publishing them (giving the server the key and IV).

When a timelapse is published, it can either be set to **public** or **unlisted**. An *unlisted* timelapse can only be viewed by administrators and the author, as well as anyone with a private, uniquely generated URL. A *public* timelapse is publicly shared on the website.

Timelapses can be synchronized with Hackatime. This will create a WakaTime heartbeat for each snapshot. Timelapses that are synchronized can always be reviewed by administrators for fraud.

## REST API endpoints
All requests and responses are serialized with JSON. Each response has an `ok` field, which determines the structure of the returned object. All responses can be described by the `Result<T>` structure:

```ts
type Ok<T> = { ok: true, value: T }
type Err<E> = { ok: false, error: E }
type Result<T> = Ok<T> | Err<string>
```

### Users - `/api/user`
Users log in with known third-party services through OAuth, and receive a Lapse-specific Bearer token.

Three permission levels exist:
- `USER`: normal permissions.
- `ADMIN`: same as `USER`, but adds the ability to remove and review projects.
- `OWNER`: same as `ADMIN`, but adds the ability to change the permissions of non-owners, alongside full project editing permissions.

The following definitions apply:

```ts
// User-modifiable entity fields
type UserFields = {
    // Contains public user information.
    profile: UserProfile

    // The API key to use when synchronizing with Hackatime.
    hackatimeApiKey?: string
}

// Public-facing user fields.
type UserProfile = {
    // The unique handle of the user.
    handle: string

    // The display name of the user. Cannot be blank.
    displayName: string

    // The bio of the user. Maximum of 160 characters.
    bio: string

    // Featured URLs that should be displayed on the user's page. This array has a maximum of 4 members.
    urls: string[]
}

// Full entity structure
type User = UserFields & {
    // The UUID of the user. Similarly to `handle`, this can uniquely identify a user - however, the `id`
    // of a user can never change.
    id: string

    // The creation date of the account, represented with a Unix timestamp.
    createdAt: number

    // Determines the permissions of the user.
    permissionLevel: "USER" | "ADMIN" | "ROOT"
}
```

#### `/api/user/query`
Finds a profile by its handle *or* ID.

- **Authentication:** bearer token
- **HTTP method**: `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the profile to query. Can be undefined if `handle` is specified.
    id: string

    // The handle of the profile to query. Can be undefined if `id` is specified.
    handle: string
}

type Response = Result<UserProfile>
```

#### `/api/profile/login`
Logs in with an external OAuth provider. Currently, only Slack is supported. If the user hasn't logged in before, a new account will be created.

- **Authentication:** not required
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The OAuth token received from the specified service.
    oauthToken: string

    // The service the user wants to authenticate with.
    service: "SLACK"
}

type Response = Result<{
    // The Bearer token to use for all authenticated requests.
    token: string
    
    // 'false' when the user account was just created, 'true' otherwise. This field can be used to
    // e.g. start onboarding for a new user.
    existed: boolean

    // Details about the user account.
    user: User
}>
```

#### `/api/profile/edit`
Edits user profile information.

- **Authentication:** bearer token
- **HTTP method**: `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The ID of the target user to edit. If the calling user has their permissionLevel set to "USER",
    // this field can only be set to their ID.
    target: string;

    // The unique handle of the user.
    handle: string

    // The display name of the user. 
    displayName: string
}

type Response = Result<{
    // No data.
}>
```

### Timelapses - `/api/timelapse`
Timelapses are collections of snapshots, which can be later synchronized with a single Hackatime project. The following definitions apply:

```ts
// User-modifiable entity fields
type TimelapseFields = {
    // The name (title) of the timelapse.
    name: string

    // The description of the timelapse.
    description: string

    // The privacy settings of the timelapse.
    privacy: "UNLISTED" | "PUBLIC"
}

// Full entity structure
type Timelapse = TimelapseFields & {
    // The UUID of the timelapse.
    id: string

    // 'true' if the timelapse has been published. A published timelapse is immutable, and all of its
    // snapshots are readable by the server.
    isPublished: boolean

    // The Hackatime project key that has been associated with this timelapse. If undefined,
    // the timelapse's snapshots have not yet been converted to Hackatime heartbeats.
    hackatimeProject?: string
}
```

#### `/api/timelapse/query`
Finds a timelapse by its ID. If the timelapse is not yet published, and the user does not own the timelapse, the endpoint will report that the timelapse does not exist.

- **Authentication:** bearer token
- **HTTP method**: `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the timelapse to query information about.
    id: string
}

type Response = Result<Timelapse>
```

#### `/api/timelapse/create`
Creates a timelapse - a named collection of snapshots, which may be associated with a Hackatime project.

- **Authentication:** bearer token
- **HTTP method**: `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = WithRequired<Partial<TimelapseFields>, "name">
type Response = Result<Timelapse>
```

#### `/api/timelapse/update`
Updates a timelapse.

- **Authentication:** bearer token
- **HTTP method**: `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = Partial<TimelapseFields>
type Response = Result<Timelapse>
```

#### `/api/timelapse/delete`
Permanently deletes a timelapse owned by the user.

- **Authentication:** bearer token
- **HTTP method**: `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the timelapse to delete. The timelapse has to be owned by the calling user.
    id: string
}

type Response = Result<{
    // No extra data returned.
}>
```

#### `/api/timelapse/publish`
Publishes a timelapse, making it immutable and accessible by administrators. This will decrypt all of the snapshots. If not unlisted, will also make the timelapse public.

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the timelapse to published. 
    id: string

    // The 256-bit key used to encrypt the snapshots, serialized as a hex string. Lowercase is recommended.
    key: string

    // The 128-bit initialization vector (IV) used to encrypt the snapshot, serialized as a hex string.
    // Lowercase is recommended.
    iv: string
}

type Response = Result<{
    // No extra data returned.
}>
```

#### `/api/timelapse/syncHackatime`
Converts all snapshots of a timelapse to Hackatime heartbeats. The timelapse has to be published, and the user has to have a valid Hackatime API key associated.

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the timelapse to synchronize. The timelapse has to be published and owned by the calling user.
    id: string

    // The Hackatime project name.
    hackatimeName: string
}

type Response = Result<{
    // No extra data returned.
}>
```

### Snapshots - `/api/snapshot`
A snapshot is a single frame of a timelapse.

The following definitions apply:

```ts
// Full entity structure
type Snapshot = {
    // The UUID of the snapshot.
    id: string

    // The ID of the timelapse this snapshot belongs to.
    timelapseId: string
}
```

#### `/api/snapshot/create`
Creates a snapshot. 

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The ID of the timelapse to associate with the snapshot. The user must be an owner of this timelapse.
    // This field CANNOT be modified later.
    ownerId: string
}

type Response = Result<{
    // The UUID of the created snapshot.
    id: string
}>
```

#### `/api/snapshot/attach?id=<ID>&checksum=<CHECKSUM>`
Adds or replaces the attached encrypted image data of a snapshot. The snapshot's UUID has to be specified in the `id` query parameter. The CRC32 checksum of the decrypted image data should be specified via the `checksum` query parameter.

The maximum file size for a snapshot is 128 KiB. It's recommended to encode the images to AVIF and downscale them to a resolution equivalent to HD (720p).

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** binary data/JSON

```ts
type Response = Result<{
    // No data.
}>
```

#### `/api/snapshot/delete`
Deletes a snapshot.

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the snapshot to delete. The snapshot has to be owned by the calling user.
    id: string
}

type Response = Result<{
    // No extra data returned.
}>
```

### Service management - `/api/admin`
All of the endpoints in `/api/admin` need authentication for either `ADMIN` or `OWNER` permissions.

#### `/api/admin/promote`
Changes the permission level of the given non-owner user to `ADMIN`. Can only be invoked by users that have a `OWNER` permission level.

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the user to promote.
    id: string
}

type Response = Result<{
    // No extra data returned.
}>
```

#### `/api/admin/demote`
Changes the permission level of the given non-owner user to `ADMIN`. Can only be invoked by users that have a `OWNER` permission level.

- **Authentication:** bearer token
- **HTTP method:** `POST`
- **Interchange (input/output):** JSON/JSON

```ts
type Request = {
    // The UUID of the user to promote.
    id: string
}

type Response = Result<{
    // No extra data returned.
}>
```
