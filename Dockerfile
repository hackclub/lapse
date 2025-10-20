FROM node:22-alpine AS base

FROM base AS builder

WORKDIR /app

COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn --frozen-lockfile

COPY src ./src
COPY public ./public
COPY next.config.ts .
COPY tailwind.config.ts .
COPY tsconfig.json .
COPY postcss.config.mjs .
COPY eslint.config.mjs .

# Only DATABASE_URL needed at build time for Prisma generation
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

RUN yarn build

FROM base AS runner

RUN apk --no-cache add curl

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy node_modules and other necessary files for migrations
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/prisma ./prisma

USER nextjs

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000

# Run migrations at startup, then start the app  
# All environment variables will be injected by Coolify at runtime
CMD ["sh", "-c", "yarn db:migrate && HOSTNAME=0.0.0.0 node server.js"]
