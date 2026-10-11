#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_mode="${1:-unit}"
test_id="chronicler_checks_${RANDOM}_$$"
test_database="${test_id}_database"
test_runner="${test_id}_runner"
test_media="${test_id}_media"
test_image="${CHRONICLER_CHECK_IMAGE:-localhost/chronicler-web:checks}"
fixture_root="${CHRONICLER_FIXTURE_ROOT:-$PWD/data}"
cleanup() {
  podman rm -fv "$test_runner" "$test_media" "$test_database" >/dev/null 2>&1 || true
  podman network rm "$test_id" >/dev/null 2>&1 || true
  podman volume rm "${test_id}_data" >/dev/null 2>&1 || true
}
trap cleanup EXIT
case "$test_mode" in
  check|build|unit|integration|documents|browser|media) ;;
  *) echo 'Usage: test.sh [check|build|unit|integration|documents|browser|media]' >&2; exit 1;;
esac
if [[ "$test_mode" == browser ]]; then
  podman build -t localhost/chronicler-browser:checks -f infra/browser.Containerfile .
  mkdir -p data/browser-results
  podman run --rm --name "$test_runner" --network host -e "WEB_URL=${WEB_URL:-http://localhost:5173}" -v "$PWD/data/browser-results:/results" -e BROWSER_RESULTS=/results localhost/chronicler-browser:checks bun run test:e2e
  exit
fi
podman build --target development -t "$test_image" -f infra/web.Containerfile .
if [[ "$test_mode" == check || "$test_mode" == build || "$test_mode" == unit ]]; then
  command="$test_mode"; if [[ "$command" == unit ]]; then command=test; fi
  podman run --rm --name "$test_runner" "$test_image" bun run "$command"
  exit
fi
podman volume create "${test_id}_data" >/dev/null
if [[ "$test_mode" == media ]]; then
  podman build --target checks -t localhost/chronicler-media:checks -f infra/media.Containerfile .
  podman run --rm -v "${test_id}_data:/data" "$test_image" bun apps/web/tests/support/export-contracts.ts
  podman run --rm --name "$test_runner" -v "${test_id}_data:/data" -v "$fixture_root/recordings:/data/recordings:ro" -v "$fixture_root/documents:/data/documents:ro" -v "$PWD/services/media:/checks:ro" -e PYTHONPATH=/service localhost/chronicler-media:checks python -m unittest discover -s /checks -p 'test_*.py'
  exit
fi
podman network create "$test_id" >/dev/null
podman run -d --name "$test_database" --network "$test_id" --network-alias test-database -e POSTGRES_USER=chronicler -e POSTGRES_PASSWORD=local-only -e POSTGRES_DB=postgres docker.io/pgvector/pgvector:0.8.2-pg17 >/dev/null
for attempt in {1..30}; do
  if podman exec "$test_database" pg_isready -U chronicler >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 30 ]]; then echo 'Test database did not become ready' >&2; exit 1; fi
  sleep 1
done
runner_args=("${@:2}")
fixture_args=()
if [[ "$test_mode" == documents ]]; then
  for filename in 260629_VLM.pdf 260629_VLM.pptx ITRI_VLM_Midterm_Report.pdf; do [[ -f "$fixture_root/documents/$filename" ]] || { echo "Missing fixture: $filename" >&2; exit 1; }; done
  podman run -d --name "$test_media" --network "$test_id" --network-alias media -v "${test_id}_data:/data" -v "$fixture_root/documents:/fixtures:ro" localhost/chronicler-media:local >/dev/null
  for attempt in {1..30}; do
    if podman exec "$test_media" python -c 'import urllib.request; urllib.request.urlopen("http://localhost:8000/health",timeout=2)' >/dev/null 2>&1; then break; fi
    if [[ "$attempt" == 30 ]]; then echo 'Test media did not become ready' >&2; exit 1; fi
    sleep 1
  done
  podman exec "$test_media" python -c 'from pathlib import Path; from documents import render_page; import tempfile; Path("/data/input").mkdir(); tmp=tempfile.TemporaryDirectory(); image=render_page(Path("/fixtures/260629_VLM.pdf"),1,Path(tmp.name)); rotated=image.rotate(90,expand=True); exif=rotated.getexif(); exif[274]=6; rotated.save("/data/input/rotated.jpg",exif=exif); tmp.cleanup()'
  runner_args+=(--suite=documents)
  fixture_args+=(-v "$fixture_root/documents:/fixtures:ro")
fi
podman run --rm --name "$test_runner" --network "$test_id" -e TEST_DATABASE_URL=postgres://chronicler:local-only@test-database:5432/postgres -e MEDIA_URL=http://media:8000 -v "${test_id}_data:/data" "${fixture_args[@]}" "$test_image" bun run test:integration "${runner_args[@]}"
