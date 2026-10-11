#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
memory_database="chronicler_migration_test_${RANDOM}_$$"
memory_runner="chronicler-migration-test-$$"
memory_data="$PWD/data/tests/$memory_database"
mkdir -p "$memory_data"
cleanup() {
  podman rm -f "$memory_runner" >/dev/null 2>&1 || true
  podman exec chronicler_database_1 dropdb --force -U chronicler "$memory_database" >/dev/null 2>&1 || true
  rm -rf "$memory_data"
}
trap cleanup EXIT
podman exec chronicler_database_1 createdb -U chronicler "$memory_database"
podman run --rm --name "$memory_runner" --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$memory_database" \
  -e MIGRATION_TEST_DATABASE=1 -e OPENAI_API_KEY= -e OPENAI_MODEL= -e OPENAI_BASE_URL= \
  -v "$PWD:/app" -v "$memory_data:/data" -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun test apps/web/tests/migrations.integration.test.ts'
