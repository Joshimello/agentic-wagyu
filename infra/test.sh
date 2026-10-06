#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
database_name="chronicler_test_${RANDOM}_$$"
test_container="chronicler-test-$$"
test_data="$PWD/data/tests/$database_name"
mkdir -p "$test_data"
cleanup() {
  podman rm -f "$test_container" >/dev/null 2>&1 || true
  podman exec chronicler_database_1 dropdb --force -U chronicler "$database_name" >/dev/null 2>&1 || true
  rm -rf "$test_data"
}
trap cleanup EXIT
podman exec chronicler_database_1 createdb -U chronicler "$database_name"
podman run --rm --name "$test_container" --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$database_name" \
  -e OPENAI_API_KEY= -e OPENAI_MODEL= -e OPENAI_BASE_URL= \
  -v "$PWD:/app" -v "$test_data:/data" -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun run --cwd apps/web db:migrate && bun run test'
