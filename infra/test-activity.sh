#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
workspace_root="$(pwd -P)"
database_name="chronicler_activity_test_${RANDOM}_$$"
test_container="chronicler-activity-test-$$"
mkdir -p "$workspace_root/data/tests"
test_data="$(mktemp -d "$workspace_root/data/tests/chronicler-activity.XXXXXX")"
created=false
cleanup() {
  podman rm -f "$test_container" >/dev/null 2>&1 || true
  if "$created"; then podman exec chronicler_database_1 dropdb --force -U chronicler "$database_name" >/dev/null 2>&1 || true; fi
  case "$(realpath "$test_data")" in
    "$workspace_root/data/tests/chronicler-activity."*) rm -rf -- "$test_data" ;;
    *) printf 'Retained test storage outside workspace: %s\n' "$test_data" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
podman exec chronicler_database_1 createdb -U chronicler "$database_name"
created=true
podman run --rm --name "$test_container" --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$database_name" \
  -e ACTIVITY_TEST_DATABASE=1 -e DATA_ROOT=/tmp/chronicler-activity \
  -e MEDIA_URL=http://127.0.0.1:9 -e OPENAI_API_KEY= -e OPENAI_MODEL= -e OPENAI_BASE_URL= \
  -v "$workspace_root:/app" -v "$test_data:/tmp/chronicler-activity" -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun apps/web/src/lib/server/db/migrate.ts && bun test --timeout 10000 apps/web/tests/activity.integration.test.ts'
