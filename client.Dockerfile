# syntax=docker/dockerfile:1.7-labs

############################  base  ##############################
FROM --platform=$TARGETPLATFORM node:25-alpine AS base
RUN apk update && apk add --no-cache libc6-compat curl bash git

RUN npm install -g pnpm@latest

ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

############################  deps  ##############################
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json ./apps/client/
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

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

RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
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
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node apps/client/server.js"]
