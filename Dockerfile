# syntax=docker/dockerfile:1.7-labs
############################  deps  ############################
FROM --platform=$TARGETPLATFORM node:18-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy only lockfile & manifest so `pnpm install` can be cached
COPY pnpm-lock.yaml package.json ./
# Copy prisma directory for schema generation during postinstall
COPY prisma ./prisma

# Cache pnpm's global store to avoid network on rebuilds
RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    --mount=type=cache,id=prisma-cache,target=/root/.cache/prisma \
    pnpm install --frozen-lockfile

###########################  builder  ##########################
FROM deps AS builder
WORKDIR /app

# Copy the rest of the source AFTER deps layer -> keeps cache hot
COPY . .

# Prisma engines download are also cached
RUN --mount=type=cache,id=prisma-cache,target=/root/.cache/prisma \
    --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    NODE_ENV=production pnpm run build

RUN apk update && apk add bash 

######################  prod-deps (runtime)  ####################
# Install ONLY the packages required at runtime, plus Prisma for migrations
FROM deps AS prod-deps
WORKDIR /app
# Install all deps first (including devDeps for prisma generate), then prune
RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    pnpm install --frozen-lockfile
# Keep prisma in production for migrations 
RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    pnpm prune --production
RUN --mount=type=cache,id=pnpm-cache,target=/root/.local/share/pnpm \
    pnpm add prisma

############################  runner  ###########################
FROM --platform=$TARGETPLATFORM node:18-alpine AS runner
WORKDIR /app

# Install pnpm and curl for Coolify
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache curl

# Non-root user (using Alpine syntax)
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

# Copy runtime files with proper ownership
COPY --from=prod-deps --chown=nextjs:nextjs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=1

EXPOSE 3000

# Run db push to create schema, then start NextJS (standalone ships server.js)
CMD ["sh","-c","pnpm run db:push && HOSTNAME=0.0.0.0 node server.js"]