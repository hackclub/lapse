# syntax=docker/dockerfile:1.7-labs

############################  base  ##############################
FROM --platform=$TARGETPLATFORM node:25-alpine AS base
RUN apk update && apk add --no-cache libc6-compat curl bash

# Install pnpm
RUN npm install -g pnpm@latest

# Equivalent to what we'd be doing with pnpm setup
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

############################  builder  ###########################
FROM base AS builder
WORKDIR /app

RUN pnpm add -g turbo@^2

COPY . .

# Generate a partial monorepo with a pruned lockfile
RUN turbo prune @lapse/web --docker

############################  installer  #########################
FROM base AS installer
WORKDIR /app

# Build-time arguments for environment variables
ARG S3_ENCRYPTED_BUCKET_NAME
ARG S3_PUBLIC_BUCKET_NAME
ARG S3_TRACING_BUCKET_NAME
ARG PRIVATE_KEY_UPLOAD_KEY
ARG S3_ENDPOINT
ARG S3_ACCESS_KEY_ID
ARG S3_SECRET_ACCESS_KEY
ARG S3_PUBLIC_URL_ENCRYPTED
ARG S3_PUBLIC_URL_PUBLIC
ARG NEXT_PUBLIC_SLACK_CLIENT_ID
ARG SLACK_CLIENT_SECRET
ARG JWT_SECRET
ARG UPLOAD_TOKEN_PRIVATE_KEY
ARG UPLOAD_TOKEN_IV
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_AUTH_TOKEN
ARG DATABASE_URL

# First install dependencies (they change less often)
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy prisma schema before install so postinstall can generate client
COPY --from=builder /app/out/full/apps/web/prisma ./apps/web/prisma

# Cache pnpm's global store to avoid network on rebuilds
RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    --mount=type=cache,id=prisma-cache,target=/root/.cache/prisma \
    pnpm install --frozen-lockfile

# Build the project and apps
COPY --from=builder /app/out/full/ .

# Copy .env file from root to apps/web if it exists
RUN --mount=from=builder,source=/app,target=/source \
    if [ -f /source/.env ]; then cp /source/.env ./apps/web/; fi

RUN --mount=type=cache,id=prisma-cache,target=/root/.cache/prisma \
    --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    NODE_ENV=production pnpm turbo run build

############################  runner  ############################
FROM base AS runner
WORKDIR /app

# Non-root user
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/prisma ./apps/web/prisma

# Switch to non-root user
USER nextjs

# Environment variables for nextjs user
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
ENV PNPM_HOME="/home/nextjs/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

EXPOSE 3000

# Start NextJS (standalone ships server.js)
CMD ["sh","-c","HOSTNAME=0.0.0.0 node apps/web/server.js"]
