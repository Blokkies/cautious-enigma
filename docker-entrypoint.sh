#!/bin/sh
set -e

# Migrations are idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
# so it's safe to run them on every container start. Set SKIP_MIGRATIONS=1 to opt out.
if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "[entrypoint] Running database migrations..."
  node ./migrate.cjs
fi

echo "[entrypoint] Starting Stocktake ${APP_VERSION:-V2}..."
exec node server.js
