FROM node:18-alpine AS base

FROM base AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn --frozen-lockfile

COPY src ./src
COPY public ./public
COPY next.config.ts .
COPY prisma ./prisma
COPY tailwind.config.ts .
COPY tsconfig.json .
COPY postcss.config.mjs .
COPY eslint.config.mjs .

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
ARG BASIC_AUTH_USER
ENV BASIC_AUTH_USER=${BASIC_AUTH_USER}
ARG BASIC_AUTH_PASSWORD
ENV BASIC_AUTH_PASSWORD=${BASIC_AUTH_PASSWORD}

RUN yarn db:migrate && yarn build

FROM base AS runner

RUN apk --no-cache add curl

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
ARG BASIC_AUTH_USER
ENV BASIC_AUTH_USER=${BASIC_AUTH_USER}
ARG BASIC_AUTH_PASSWORD
ENV BASIC_AUTH_PASSWORD=${BASIC_AUTH_PASSWORD}

EXPOSE 3000

ENV PORT 3000

CMD HOSTNAME=0.0.0.0 node server.js
