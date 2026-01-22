<h1>
    <img height="64" src="./apps/web/src/client/assets/icon.svg">&nbsp;&nbsp;
    Hack Club Lapse
</h1>

[**Lapse**](https://lapse.hackclub.com) is a place for Hack Clubbers to record and share timelapses. Integrates with [Hackatime](https://hackatime.hackclub.com)! Lapse is currently in beta.

Think of it like a fancy WakaTime plugin. Just as you can install WakaTime for VS Code, Lapse serves to be the WakaTime plugin for timelapses.

All timelapses are encrypted before being published. That means that you (and *only* you!) can access them. That way, we can synchronize your progress with our servers, while still making it possible for you to censor or remove anything you wouldn't want other people to see.

## 🧑‍💻 Development
In order to get started with developing Lapse, run these commands:
```bash
# Install all packages
pnpm install

# cd into the web app directory
cd apps/web

# Initialize the development environment
pnpm dev:init

# Start the development server
pnpm turbo run dev
```
To start and stop the development environment, use `pnpm dev:start-env` and `pnpm dev:stop-env` respectively.

## 🛠️ Deployment
Lapse is meant to be deployed via Docker. In order to deploy the main frontend/backend microservice, use `Dockerfile.web`, located in the root of this repo.

For example - when deploying with Coolify, set these settings:
- `Base Directory`: `/`
- `Dockerfile Location`: `/Dockerfile.web`
- `Ports Exposes`: `3000`

You'll also need a PostgreSQL database running. The connection string to that database should be present in `DATABASE_URL`.

You'll need at least one root user in order to promote other users to admins. You can do this via the [`./apps/web/prisma/promote.ts`](./apps/web/prisma/promote.ts) script:

```sh
# You'd probably want to use your production database URL here.
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lapse?schema=public"
pnpm -F web exec tsx ./prisma/promote.ts --email ascpixi@hackclub.com
```
