# Stocktake V2 — production image for Coolify (Dockerfile build pack)

# ---- deps ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders only: modules that validate env at import time need
# something during `next build`. Real values are injected by Coolify at runtime.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build \
    JWT_SECRET=build-only-placeholder \
    ADMIN_PASSWORD=build-only-placeholder \
    npm run build
# Bundle the migration script so the runtime image doesn't need tsx/devDependencies
RUN npx esbuild src/lib/db/migrate.ts --bundle --platform=node --target=node20 \
    --format=cjs --outfile=dist/migrate.cjs

# ---- run ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# curl is required by Coolify's container health check (alpine ships without it)
RUN apk add --no-cache curl
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/dist/migrate.cjs ./migrate.cjs
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
