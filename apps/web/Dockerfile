FROM node:18-alpine AS base

FROM base AS builder
RUN apk update
RUN apk add --no-cache libc6-compat
# Set working directory
WORKDIR /app
# Install turbo
RUN yarn global add turbo@^2
# Copy everything from root (Coolify build context)
COPY . .

# Generate a partial monorepo with a pruned lockfile for a target workspace.
RUN turbo prune @lapse/web --docker

# Add lockfile and package.json's of isolated subworkspace
FROM base AS installer
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install Bun
RUN npm install -g bun

# First install the dependencies (as they change less often)
COPY --from=builder /app/out/json/ .
RUN bun install --frozen-lockfile

# Build the project
COPY --from=builder /app/out/full/ .
# Copy .env file from root for Coolify environment variables
COPY --from=builder /app/.env* ./
RUN bun run turbo build

FROM base AS runner
WORKDIR /app

# Install Bun for runtime
RUN npm install -g bun

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy .env file for runtime environment variables
COPY --from=installer --chown=nextjs:nodejs /app/.env* ./

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

CMD node apps/web/server.js
