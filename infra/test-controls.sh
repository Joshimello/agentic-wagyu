#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

workspace_root="$(pwd -P)"
suite_suffix="${RANDOM}_$$"
control_database="chronicler_control_test_$suite_suffix"
removal_database="chronicler_removal_test_$suite_suffix"
control_container="chronicler-controls-$suite_suffix"
removal_container="chronicler-removal-$suite_suffix"
mkdir -p "$workspace_root/data/tests"
suite_data="$(mktemp -d "$workspace_root/data/tests/chronicler-controls.XXXXXX")"
control_created=false
removal_created=false

cleanup() {
  podman rm -f "$control_container" "$removal_container" >/dev/null 2>&1 || true
  if "$control_created"; then
    podman exec chronicler_database_1 dropdb --force -U chronicler "$control_database" >/dev/null 2>&1 || true
  fi
  if "$removal_created"; then
    podman exec chronicler_database_1 dropdb --force -U chronicler "$removal_database" >/dev/null 2>&1 || true
  fi
  # Only the fresh temporary directory allocated by this runner is removable.
  case "$(realpath "$suite_data")" in
    "$workspace_root/data/tests/chronicler-controls."*) rm -rf -- "$suite_data" ;;
    *) printf 'Retained test storage outside the workspace: %s\n' "$suite_data" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$suite_data/control" "$suite_data/removal"

podman exec chronicler_database_1 createdb -U chronicler "$control_database"
control_created=true
podman exec chronicler_database_1 createdb -U chronicler "$removal_database"
removal_created=true

podman run --rm --name "$control_container" --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$control_database" \
  -e CONTROL_TEST_DATABASE=1 -e DATA_ROOT=/tmp/chronicler-controls \
  -e MEDIA_URL=http://127.0.0.1:9 \
  -e OPENAI_API_KEY= -e OPENAI_MODEL= -e OPENAI_BASE_URL= \
  -v "$workspace_root:/app" -v "$suite_data/control:/tmp/chronicler-controls" \
  -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun apps/web/src/lib/server/db/migrate.ts && bun test --timeout 10000 apps/web/tests/job-control.integration.test.ts apps/web/tests/video-checkpoint.test.ts'

podman run --rm --name "$removal_container" --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$removal_database" \
  -e REMOVAL_TEST_DATABASE=1 -e DATA_ROOT=/tmp/chronicler-removal \
  -e MEDIA_URL=http://127.0.0.1:9 \
  -e OPENAI_API_KEY= -e OPENAI_MODEL= -e OPENAI_BASE_URL= \
  -v "$workspace_root:/app" -v "$suite_data/removal:/tmp/chronicler-removal" \
  -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun apps/web/src/lib/server/db/migrate.ts && bun test --timeout 10000 apps/web/tests/removal.integration.test.ts'
