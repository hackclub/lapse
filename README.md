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

# Use example environment variables
cp ./apps/web/.env.example ./apps/web/.env
```

You also need a PostgreSQL database running. The simplest way to get one up and running is via Docker:
```bash
# In this case, your DATABASE_URL environment variable would be "postgresql://postgres:postgres@localhost:5432/lapse?schema=public".
# You only need to run this command once - this creates the container!
docker run -d --name lapse-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```

...if you already created the PostgreSQL container but it's not running, use the following to get it back up:
```bash
docker start lapse-db
```

You'll have to change some environment variables in `./apps/web/.env`. Don't worry - everything is explained in the comments in the `.env` file! After you're done, run this command to get started:

```bash
pnpm turbo run dev
```

If you're running `db:dev` for the very first time, you'll have to create the schema:

```bash
# Make sure that your PostgreSQL server is running! See above on how to set it up.
pnpm turbo run db:push
```

You also have a couple of development scripts at hand:
```bash
# You'll need this to use any of the scripts in ./apps/web/prisma!
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lapse?schema=public"

# Generate a JWT cookie to log in without having to auth through Slack
node ./apps/web/prisma/create-jwt.mjs --email ascpixi@hackclub.com

# Create a mock user without going through Slack
node ./apps/web/prisma/create-user.mjs --email ascpixi@hackclub.com --sid U082DPCGPST --handle ascpixi --name ascpixi --pfp https://ca.slack-edge.com/T0266FRGM-U082DPCGPST-0c4754eb6211-512
```

## 🛠️ Deployment
Lapse is meant to be deployed via Docker. In order to deploy the main frontend/backend microservice, use `Dockerfile.web`, located in the root of this repo.

For example - when deploying with Coolify, set these settings:
- `Base Directory`: `/`
- `Dockerfile Location`: `/Dockerfile.web`
- `Ports Exposes`: `3000`

You'll also need a PostgreSQL database running. The connection string to that database should be present in `DATABASE_URL`.

You'll need at least one root user in order to promote other users to admins. You can do this via the [`./apps/web/prisma/promote.mjs`](./apps/web/prisma/promote.mjs) script:

```sh
# You'd probably want to use your production database URL here.
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lapse?schema=public"
node ./prisma/promote.mjs --email ascpixi@hackclub.com
```
