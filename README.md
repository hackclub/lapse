<h1>
    <img height="64" src="./apps/client/src/assets/icon.svg">&nbsp;&nbsp;
    Hack Club Lapse
</h1>

[**Lapse**](https://lapse.hackclub.com) is a place for Hack Clubbers to record and share timelapses. Integrates with [Hackatime](https://hackatime.hackclub.com)! Lapse is currently in beta.

Think of it like a fancy WakaTime plugin. Just as you can install WakaTime for VS Code, Lapse serves to be the WakaTime plugin for timelapses.

All timelapses are encrypted before being published. That means that you (and _only_ you!) can access them. That way, we can synchronize your progress with our servers, while still making it possible for you to censor or remove anything you wouldn't want other people to see.

## 🧑‍💻 Development

In order to get started with developing Lapse, run these commands:

```bash
# Install all packages
pnpm install

# Set up the development environment (makes the .env file for you)
pnpm dev:setup-env

# Start the web client and backend
pnpm dev
```

You'll need to install ffmpeg as well.

- Windows: install Chocolatey and then run `choco install ffmpeg` in an Administrative command prompt
- Mac: installed homebrew and then run `brew install ffmpeg`
- Linux: install ffmpeg with your package manager

To start and stop the development environment, use `pnpm dev:start-env` and `pnpm dev:stop-env` respectively.

When developing, it's a good idea to re-compile all packages on the fly!

```bash
pnpm dev:watch-all
```

If you're interested, you're welcome to build your own custom client! See [`./docs/custom-clients.md`](./docs/custom-clients.md) for more info.

## 🛠️ Deployment

Lapse is meant to be deployed via Docker, featuring three main services out-of-the-box: `client`, `server`, and `worker`.

- `client`: the web client server. Interfaces with `server` - use `Dockerfile.client` to deploy this service.
- `server`: the backend server. Use `Dockerfile.server` to deploy this service.
- `worker`: background job worker. This service is CPU-bound - it's a good idea to put it on a beefy server! Handles tasks like encoding. Use `Dockerfile.worker` to deploy this service.

Both `server` and `worker` interface via Redis. You can put them on separate machines, as long as both have access to the same Redis server. `server` additionally needs a PostgreSQL database. Schemas are automatically applied - no need for any special setup.

In order to deploy the main frontend/backend microservice, use `Dockerfile.web`, located in the root of this repo.

For example - when deploying with Coolify, set these settings:

- `Base Directory`: `/`
- `Dockerfile Location`: `/Dockerfile.web`
- `Ports Exposes`: `3000`

You'll need at least one root user in order to promote other users to admins. The recommended way to do this is via the `console.ts` script of `server`!

```sh
cd apps/server

# You'll be taken to a REPL after launching this!
pnpm dev:console
```

```ts
connect("postgresql://postgres:postgres@localhost:5432/lapse?schema=public"); // you'll probably want your production database URL here!
await promoteUser("ascpixi@hackclub.com");
```
