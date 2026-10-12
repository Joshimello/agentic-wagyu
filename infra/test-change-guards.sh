#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_id="chronicler_change_guards_${RANDOM}_$$"
test_image="${CHRONICLER_CHECK_IMAGE:-localhost/chronicler-web:checks}"
cleanup(){ podman rm -f "${test_id}_database" >/dev/null 2>&1 || true; podman network rm "$test_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
podman build --target development -t "$test_image" -f infra/web.Containerfile .
podman network create "$test_id" >/dev/null
podman run -d --name "${test_id}_database" --network "$test_id" --network-alias database -e POSTGRES_USER=chronicler -e POSTGRES_PASSWORD=local-only -e POSTGRES_DB=postgres docker.io/pgvector/pgvector:0.8.2-pg17 >/dev/null
for attempt in {1..30}; do if podman exec "${test_id}_database" pg_isready -U chronicler >/dev/null 2>&1; then break; fi; sleep 1; done
podman run --rm --network "$test_id" -e TEST_DATABASE_URL=postgres://chronicler:local-only@database:5432/postgres "$test_image" bun apps/web/tests/support/mutate-change-guards.ts
