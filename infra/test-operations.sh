#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
operations_database="chronicler_operations_${RANDOM}_$$"
operations_data="$PWD/data/tests/$operations_database"
mkdir -p "$operations_data"
cleanup() {
  podman exec chronicler_database_1 dropdb --force -U chronicler "$operations_database" >/dev/null 2>&1 || true
  rm -rf "$operations_data"
}
trap cleanup EXIT
podman exec chronicler_database_1 createdb -U chronicler "$operations_database"
podman run --rm --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$operations_database" -e OPERATIONS_TEST=true \
  -v "$PWD:/app" -v "$operations_data:/data" -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun run --cwd apps/web db:migrate && bun test apps/web/tests/operations.integration.test.ts'
