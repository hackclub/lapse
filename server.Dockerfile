# syntax=docker/dockerfile:1.7-labs

############################  base  ##############################
FROM --platform=$TARGETPLATFORM node:25-alpine AS base
RUN apk update && apk add --no-cache libc6-compat curl bash

RUN npm install -g pnpm@latest

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

############################  deps  ##############################
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/api/package.json ./packages/api/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/shared/package.json ./packages/shared/

RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    pnpm install --frozen-lockfile --ignore-scripts

############################  builder  ###########################
FROM deps AS builder
WORKDIR /app

COPY packages/shared/ ./packages/shared/
COPY packages/api/ ./packages/api/
COPY packages/jobs/ ./packages/jobs/
COPY apps/server/ ./apps/server/

RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    --mount=type=cache,id=prisma-cache,target=/root/.cache/prisma \
    pnpm --filter @hackclub/lapse-shared run build && \
    pnpm --filter @hackclub/lapse-api run build && \
    pnpm --filter @hackclub/lapse-jobs run build && \
    pnpm --filter @hackclub/lapse-server run build

############################  runner  ############################
FROM base AS runner
WORKDIR /app

RUN addgroup -S lapse && adduser -S lapse -G lapse

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/jobs/node_modules ./packages/jobs/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/apps/server/prisma.config.ts ./apps/server/prisma.config.ts
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/package.json ./packages/api/package.json
COPY --from=builder /app/packages/jobs/dist ./packages/jobs/dist
COPY --from=builder /app/packages/jobs/package.json ./packages/jobs/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy the generated Prisma client
COPY --from=builder /app/apps/server/src/generated ./apps/server/src/generated

USER lapse

ENV NODE_ENV=production
ENV PORT=8080
ENV PRISMA_HIDE_UPDATE_MESSAGE=1

EXPOSE 8080

CMD ["node", "apps/server/dist/app.js"]
