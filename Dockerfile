# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
#   Installs ALL dependencies (including devDeps needed for `nest build`),
#   then compiles TypeScript → dist/
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching — only re-installs when
# package*.json changes, not on every source file edit.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: production-deps
#   Fresh install with --omit=dev so the final image carries no devDependencies.
#   Separated from the builder stage so the build cache for node_modules is
#   independent of devDep churn.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production-deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: production
#   Minimal image — only compiled JS + production node_modules.
#   Runs as a non-root user (nestjs:nodejs, UID/GID 1001).
#   Uses tini as PID 1 to:
#     - Forward signals (SIGTERM/SIGINT) correctly to the Node process
#     - Reap zombie child processes
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# tini: lightweight init process for containers
RUN apk add --no-cache tini

WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nestjs -u 1001

# Copy only what's needed to run
COPY --from=production-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder         --chown=nestjs:nodejs /app/dist         ./dist
COPY --from=builder         --chown=nestjs:nodejs /app/package.json ./package.json

USER nestjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Docker-native health check for the API container.
# Worker containers override CMD but not HEALTHCHECK; docker-compose
# overrides the worker health check via its own healthcheck: block.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

# tini as init (PID 1) → node as the main process
# Override CMD in docker-compose to run the worker: node dist/main.worker
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
