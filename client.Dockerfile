# syntax=docker/dockerfile:1

############################  base  ##############################
FROM --platform=$TARGETPLATFORM node:26-alpine AS base
RUN apk update && apk add --no-cache libc6-compat curl bash git

RUN npm install -g pnpm@11.18.0

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

############################  lookout  ###########################
# Keep in step with the vendor/lookout submodule. A commit rather than a tag: the shared WebAssembly
# recorder engine isn't in a tagged release yet.
FROM base AS lookout
ARG LOOKOUT_REF=385480c3b8d91579191385488c1aecaaa73aace8
RUN git init -q /lookout && cd /lookout && \
    git remote add origin https://github.com/hackclub/lookout.git && \
    git fetch -q --depth 1 origin "$LOOKOUT_REF" && \
    git checkout -q FETCH_HEAD

############################  wasm  ##############################
# @lookout/react records through Lookout's Rust engine compiled to WebAssembly (@lookout/wasm).
# Only the crates under lookout-web are built; the desktop app's own sources are stand-ins so Cargo
# can read the workspace without them.
FROM --platform=$BUILDPLATFORM rust:1-slim-bookworm AS wasm
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add wasm32-unknown-unknown
WORKDIR /lookout
COPY --from=lookout /lookout/clients/desktop/src-tauri/Cargo.toml /lookout/clients/desktop/src-tauri/Cargo.lock ./clients/desktop/src-tauri/
COPY --from=lookout /lookout/packages/wasm/install-bindgen.sh ./packages/wasm/
RUN bash packages/wasm/install-bindgen.sh /usr/local/bin
COPY --from=lookout /lookout/clients/desktop/src-tauri/crates ./clients/desktop/src-tauri/crates
RUN mkdir -p clients/desktop/src-tauri/src \
    && touch clients/desktop/src-tauri/src/lib.rs clients/desktop/src-tauri/src/main.rs
COPY --from=lookout /lookout/packages/wasm/build.sh ./packages/wasm/
RUN bash packages/wasm/build.sh

############################  deps  ##############################
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json ./apps/client/
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/
COPY --from=lookout /lookout/packages/shared/package.json ./vendor/lookout/packages/shared/
COPY --from=lookout /lookout/packages/wasm/package.json ./vendor/lookout/packages/wasm/
COPY --from=lookout /lookout/clients/react/package.json ./vendor/lookout/clients/react/

RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    pnpm install --frozen-lockfile --ignore-scripts

############################  builder  ###########################
FROM deps AS builder
WORKDIR /app

ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}

COPY packages/shared/ ./packages/shared/
COPY packages/api/ ./packages/api/
COPY apps/client/ ./apps/client/
COPY --from=lookout /lookout/tsconfig.base.json ./vendor/lookout/
COPY --from=lookout /lookout/packages/shared/ ./vendor/lookout/packages/shared/
COPY --from=lookout /lookout/packages/wasm/package.json ./vendor/lookout/packages/wasm/
COPY --from=wasm /lookout/packages/wasm/dist/ ./vendor/lookout/packages/wasm/dist/
COPY --from=lookout /lookout/clients/react/ ./vendor/lookout/clients/react/

RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    pnpm --filter @lookout/shared run build && \
    pnpm --filter @lookout/react run build && \
    pnpm --filter @hackclub/lapse-shared run build && \
    pnpm --filter @hackclub/lapse-api run build && \
    pnpm --filter @lapse/lapse-client run build

############################  runner  ############################
FROM base AS runner
WORKDIR /app

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/apps/client/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/client/.next/static ./apps/client/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/apps/client/public ./apps/client/public

USER nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["node", "apps/client/server.js"]
