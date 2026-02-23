This is a repository for Lapse - a web app for tracking time spent on personal projects by recording timelapses. We use TypeScript, Next.js, Fastify, Prisma ORM, Tailwind CSS, and BullMQ for our tech stack.

This project features the following packages:
- `apps/client`: a frontend built with Next.js, interfacing with the server via the `api` package.
- `apps/server`: the main Fastify/oRPC backend for Lapse.
- `packages/api`: contracts shared between `client` and `server`. This package also allows for third-party clients to be developed for Lapse.
- `apps/worker`: a BullMQ worker responsible for tasks like encoding. Interfaces with `server`.

Database models are defined in @apps/server/prisma/schema.prisma.
API contracts are defined in @packages/api/src/contracts.
Server endpoints are implemented in @apps/server/src/routers.

When a user records a video, it first becomes a *draft timelapse* (`DraftTimelapse`). The video content of draft timelapses is always encrypted with a private key only known by the user - the server only serves to synchronize them with different user devices. This allow users to record timelapses on one device, and then edit them on the other. As draft timelapses may potentially hold PII, they must always be encrypted.

A user can choose to publish a draft timelapse, creating a `Timelapse` as a result. This involves transcoding and applying edit lists to the video via the `worker`. The contents of a regular, published timelapse are not encrypted and may be viewed by any other user.

Lapse has the ability to import data to an API-compatible WakaTime fork called Hackatime. When importing, a WakaTime heartbeat will be created for each *snapshot* - a timestamp taken with each recorded frame on the client.

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
- Do not run linters. You may verify the code style with ESLint, but do not run code formatters.
- Do not attempt to preview the site or run the server by yourself.
