#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CHRONICLER_PROJECT="${CHRONICLER_PROJECT:-chronicler_workflow_$(date -u +%Y%m%d%H%M%S)}"
export CHRONICLER_PORT="${CHRONICLER_PORT:-5174}" CHRONICLER_READ_ONLY=0
if podman volume exists "${CHRONICLER_PROJECT}_database"; then echo 'Pilot requires a fresh workspace' >&2; exit 1; fi
pilot_root="$PWD/data/evaluations/lifecycle/$CHRONICLER_PROJECT"
fixture_root="${CHRONICLER_FIXTURE_ROOT:-$PWD/data}"
mkdir -p "$pilot_root/input" "$pilot_root/reports"
podman build --target development -t localhost/chronicler-web:checks -f infra/web.Containerfile . >/dev/null
# A real five-minute excerpt, retaining the original Mandarin audio and meeting frames.
podman run --rm -v "$fixture_root/recordings:/recordings:ro" -v "$pilot_root/input:/output" --entrypoint ffmpeg localhost/chronicler-media:local -hide_banner -loglevel error -ss 600 -i /recordings/2026-09-08.mp4 -t 300 -c:v libx264 -preset veryfast -crf 25 -c:a aac /output/meeting-excerpt.mp4
for filename in '260720_VLM.pptx' '115年度資通所分包_基於VLM的目標選取與語意標註_清大_朱宏國.pptx' 'ITRI_VLM_Midterm_Report.pdf'; do
  cp --reflink=auto "$fixture_root/documents/$filename" "$pilot_root/input/$filename"
done
./infra/isolated.sh up -d
for attempt in {1..60}; do
  if podman exec "${CHRONICLER_PROJECT}_web_1" bun -e "fetch('http://localhost:5173/api/health').then(r=>process.exit(r.ok?0:1))" >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 60 ]]; then echo 'Release did not become ready' >&2; exit 1; fi
  sleep 1
done
echo "Pilot workspace: $CHRONICLER_PROJECT at http://localhost:$CHRONICLER_PORT"
workflow_runner="${CHRONICLER_PROJECT}_checks"
trap 'podman rm -f "$workflow_runner" >/dev/null 2>&1 || true' EXIT
podman run --rm --name "$workflow_runner" --network "${CHRONICLER_PROJECT}_default" \
  -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler \
  -e APP_URL=http://web:5173 -e "APP_ORIGIN=http://localhost:$CHRONICLER_PORT" -e PILOT_REPORT_ROOT=/reports \
  -v "$pilot_root/input:/corpus:ro" -v "$pilot_root/reports:/reports" \
  localhost/chronicler-web:checks bun run test:workflow --heldout --verify-restart &
workflow_pid=$!
restart_done=0
while kill -0 "$workflow_pid" 2>/dev/null; do
  if [[ -f "$pilot_root/reports/restart-requested" && "$restart_done" == 0 ]]; then
    podman restart "${CHRONICLER_PROJECT}_web_1" "${CHRONICLER_PROJECT}_worker_1" "${CHRONICLER_PROJECT}_translator_1" >/dev/null
    for attempt in {1..60}; do
      if podman exec "${CHRONICLER_PROJECT}_web_1" bun -e "fetch('http://localhost:5173/api/health').then(r=>process.exit(r.ok?0:1))" >/dev/null 2>&1; then break; fi
      if [[ "$attempt" == 60 ]]; then echo 'Release did not recover after restart' >&2; exit 1; fi
      sleep 1
    done
    touch "$pilot_root/reports/restart-complete"
    restart_done=1
  fi
  sleep 1
done
wait "$workflow_pid"
echo "Pilot results retained: $pilot_root/reports/lifecycle.json"
if [[ "${1:-}" == --evaluate ]]; then
  podman run --rm --network "${CHRONICLER_PROJECT}_default" --env-file .env \
    -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -e DATA_ROOT=/data \
    -v "${CHRONICLER_PROJECT}_data:/data" localhost/chronicler-web:checks \
    bun run eval:researcher --manifest=/app/evals/lifecycle/questions.json --repeat=3 --concurrency=3 --tag=lifecycle
  podman run --rm -v "${CHRONICLER_PROJECT}_data:/data:ro" -v "$pilot_root/reports:/reports" docker.io/oven/bun:1.4.2 \
    bun -e 'await Bun.write("/reports/heldout-summary.json",await Bun.file("/data/evaluations/researcher/lifecycle/summary-summary.json").text())'
fi
