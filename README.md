<h1>
    <img height="64" src="./apps/web/src/client/assets/icon.svg">&nbsp;&nbsp;
    Hack Club Lapse
</h1>

[**Lapse**](https://lapse.hackclub.com) is a place for Hack Clubbers to record and share timelapses. Integrates with [Hackatime](https://hackatime.hackclub.com)! Lapse is currently in beta.

## Introduction
Lapse helps you track time for anything that Hackatime is incapable of tracking. You record a timelapse of you doing something, publish it, and register your time in Hackatime! It's also a place for you to share your timelapses with others.

Think of it like a fancy WakaTime plugin. Just as you can install WakaTime for VS Code, Lapse serves to be the WakaTime plugin for timelapses.

Before you publish your timelapses, they're encrypted on your end. That means that you (and only you!) can access them. That way, we can synchronize your progress with our servers, while still making it possible for you to censor or remove anything you wouldn't want other people to see.

We currently only officially support Hackatime. Sorry!

## Nerdy Details
Lapse captures timestamped snapshots of a video feed (e.g. a user's screen or camera). Snapshots are always synchronized with the server, _and_ encrypted client-side with a key derived from:
- the user's password (which is not stored on the server),
- the ID of the timelapse.
- a salt stored in the server's .env

Currently, the algorithm used to encrypt snapshots is the browser-provided implementation of AES-256. Users can censor and remove snapshots before publishing them (giving the server the key and IV).

When a timelapse is published, it can either be set to **public** or **unlisted**. An *unlisted* timelapse can only be viewed by administrators and the author, as well as anyone with a private, uniquely generated URL. A *public* timelapse is publicly shared on the website.

Timelapses can be synchronized with Hackatime. This will create a WakaTime heartbeat for each snapshot. Timelapses that are synchronized can always be reviewed by administrators for fraud.

## REST API endpoints
Lapse uses tRPC with a REST interface being planned. This is currently not yet implemented.

## Deployment
Deploying Lapse is largely the same as deploying [any other Next.js web app](https://coolify.io/docs/applications/nextjs). You'll need to set a couple of environment variables, though - you'll find them in [`src/server/env.ts`](./src/server/env.ts).

Lapse uses Prisma with the PostgreSQL adapter - this means you'll also need a PostgreSQL database. Set the `DATABASE_URL` environment variable to the connection string of your database.

You'll need at least one root user in order to promote other users to admins. You can do this via the [`./prisma/promote.mjs`](./prisma/promote.mjs) script:

```sh
# You'd probably want to use your production database URL here.
export DATABASE_URL="prisma+postgres://localhost:51213/?api_key=something-goes-here"
node ./prisma/promote.mjs --email ascpixi@hackclub.com
```

```sh
# Same deal as with promote.mjs.
export DATABASE_URL="prisma+postgres://localhost:51213/?api_key=something-goes-here"

node ./prisma/approve.mjs # list all users pending approval
node ./prisma/approve.mjs --email ascpixi@hackclub.com # approve via email
node ./prisma/approve.mjs --slackId U082DPCGPST # approve via Slack ID
```
