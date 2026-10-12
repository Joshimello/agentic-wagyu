#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_id="chronicler_changes_browser_${RANDOM}_$$"
test_image="${CHRONICLER_CHECK_IMAGE:-localhost/chronicler-web:checks}"
test_port="${CHANGES_BROWSER_PORT:-5187}"
cleanup(){ podman rm -fv "${test_id}_web" "${test_id}_database" >/dev/null 2>&1 || true; podman network rm "$test_id" >/dev/null 2>&1 || true; podman volume rm "${test_id}_data" >/dev/null 2>&1 || true; }
trap cleanup EXIT
podman build --target development -t "$test_image" -f infra/web.Containerfile .
podman build -t localhost/chronicler-browser:checks -f infra/browser.Containerfile .
podman network create "$test_id" >/dev/null
podman volume create "${test_id}_data" >/dev/null
podman run -d --name "${test_id}_database" --network "$test_id" --network-alias database -e POSTGRES_USER=chronicler -e POSTGRES_PASSWORD=local-only -e "POSTGRES_DB=$test_id" docker.io/pgvector/pgvector:0.8.2-pg17 >/dev/null
for attempt in {1..30}; do if podman exec "${test_id}_database" pg_isready -U chronicler >/dev/null 2>&1; then break; fi; sleep 1; done
database_url="postgres://chronicler:local-only@database:5432/$test_id"
podman run --rm --network "$test_id" -e "DATABASE_URL=$database_url" "$test_image" bun apps/web/src/lib/server/db/migrate.ts
podman run --rm --network "$test_id" -e "DATABASE_URL=$database_url" -e DATA_ROOT=/data -v "${test_id}_data:/data" "$test_image" bun apps/web/tests/support/seed-changes-browser.ts
podman run -d --name "${test_id}_web" --network "$test_id" --network-alias web -p "127.0.0.1:$test_port:5173" -e "DATABASE_URL=$database_url" -e DATA_ROOT=/data -e PORT=5173 -e HOST=0.0.0.0 -v "${test_id}_data:/data" "$test_image" bun apps/web/build >/dev/null
for attempt in {1..30}; do if podman exec "${test_id}_web" bun -e "fetch('http://localhost:5173/api/health').then(r=>{if(!r.ok)process.exit(1)})" >/dev/null 2>&1; then break; fi; sleep 1; done
mkdir -p data/browser-results/changes
podman run --rm --network host -e "WEB_URL=http://localhost:$test_port" -e CHANGES_BROWSER=1 -e BROWSER_RESULTS=/results -v "${test_id}_data:/data:ro" -v "$PWD/data/browser-results/changes:/results" localhost/chronicler-browser:checks bun run --cwd apps/web test:browser tests/browser/changes.spec.ts
