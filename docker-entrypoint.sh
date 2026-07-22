#!/bin/sh
set -e

node_modules/.bin/prisma migrate deploy

# Optionally seed the initial admin during deploy. seed-admin.mjs is idempotent
# — it creates the user through better-auth (valid password hash) if missing, or
# just promotes an existing one to admin — so it's safe to run on every boot.
# Runs only when both credentials are provided as env vars; a seed failure is
# logged but never blocks the app from starting.
if [ -n "$SEED_ADMIN_EMAIL" ] && [ -n "$SEED_ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Seeding admin: $SEED_ADMIN_EMAIL"
  node scripts/seed-admin.mjs || echo "[entrypoint] WARN: admin seed failed; continuing startup."
fi

exec "$@"
