# Project Overview

Hack Club Lapse is a single-page web application (SPA) for recording timelapses created in Next.js, TypeScript, tRPC, Prisma ORM, and Tailwind CSS. It uses Yarn as its package manager. We use Pages Router with Next.js v15 to limit the use of server components.

We define the following entities:
- **timelapses**, a short video file, owned by a user.
- **snapshots**, a description for a single frame in a timelapse. Snapshots define the timestamps for each frame in a timelapse.

These are described by the models defined in `prisma/schema.prisma`.

Timelapses are stored locally on the user's browser. It is paramount that timelapses stay private and accessible only to the user before they're reviewed and/or edited by the user. However, the user might want to record timelapses on one device, and edit/review them on another. For this reason, timelapses may be *encrypted* with a key only accessible to the user before being stored on the remote server.

When a timelapse is published, it can either be set to **public** or **unlisted**. An *unlisted* timelapse can only be viewed by administrators and the author, as well as anyone with a private, uniquely generated URL. A *public* timelapse is publicly shared on the website.

Lapse has the ability to import data to an API-compatible WakaTime fork called Hackatime. When importing, a WakaTime heartbeat will be created for each *snapshot*.

This project features clear client/server separation. A file should never combine client-side and server-side code.

# Code style

- Use double quotes for strings.
- Always use semicolons.
- Avoid braces for if/else blocks that return or throw.
- Use 2 spaces as indentation for TSX files.
- Use 4 spaces as indentation for TypeScript files.
- Avoid creating comments for self-documenting code.

**Always** put `catch` and `else` blocks on their own line. For example:
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
- Prefer using Prisma's UUID generation rather than APIs like `crypto.randomUUID`.
- Avoid using server components without a clear client/server separation.
- Do not run linters. You may verify the code style with ESLint, but do not run code formatters.
