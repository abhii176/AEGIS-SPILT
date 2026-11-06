#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required" >&2
  exit 1
fi

echo "Running Prisma migrations (migrate deploy)..."
npx prisma migrate deploy

echo "Starting Aegis-Split on port ${PORT:-3000}..."
exec node src/index.js
