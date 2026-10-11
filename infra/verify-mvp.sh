#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CHRONICLER_PROJECT="${CHRONICLER_PROJECT:-chronicler_pilot_$(date -u +%Y%m%d%H%M%S)}"
export CHRONICLER_PORT="${CHRONICLER_PORT:-5174}" CHRONICLER_READ_ONLY=0
if podman volume exists "${CHRONICLER_PROJECT}_database"; then echo 'Pilot requires a fresh workspace' >&2; exit 1; fi
pilot_root="$PWD/data/evaluations/lifecycle/$CHRONICLER_PROJECT"
mkdir -p "$pilot_root/input" "$pilot_root/reports"
# A real five-minute excerpt, retaining the original Mandarin audio and meeting frames.
podman run --rm -v "$PWD/data/recordings:/recordings:ro" -v "$pilot_root/input:/output" --entrypoint ffmpeg localhost/chronicler-media:dev -hide_banner -loglevel error -ss 600 -i /recordings/2026-09-08.mp4 -t 300 -c:v libx264 -preset veryfast -crf 25 -c:a aac /output/meeting-excerpt.mp4
for filename in '260720_VLM.pptx' '115年度資通所分包_基於VLM的目標選取與語意標註_清大_朱宏國.pptx' 'ITRI_VLM_Midterm_Report.pdf'; do
  ln "$PWD/data/documents/$filename" "$pilot_root/input/$filename"
done
./infra/isolated.sh up -d
for attempt in {1..60}; do if podman exec "${CHRONICLER_PROJECT}_web_1" bun -e "fetch('http://localhost:5173/api/health').then(r=>process.exit(r.ok?0:1))" >/dev/null 2>&1; then break; fi; sleep 1; done
echo "Pilot workspace: $CHRONICLER_PROJECT at http://localhost:$CHRONICLER_PORT"
podman run --rm --network "${CHRONICLER_PROJECT}_default" \
  -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler \
  -e APP_URL=http://web:5173 -e "APP_ORIGIN=http://localhost:$CHRONICLER_PORT" -e PILOT_REPORT_ROOT=/reports \
  -v "$PWD:/app:ro" -v "$pilot_root/input:/corpus:ro" -v "$pilot_root/reports:/reports" \
  -w /app docker.io/oven/bun:1.4.2 bun run verify:mvp --heldout
echo "Pilot results retained: $pilot_root/reports/lifecycle.json"
if [[ "${1:-}" == --evaluate ]]; then
  podman run --rm --network "${CHRONICLER_PROJECT}_default" --env-file .env \
    -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -e DATA_ROOT=/data \
    -v "$PWD:/app:ro" -v "${CHRONICLER_PROJECT}_data:/data" -w /app docker.io/oven/bun:1.4.2 \
    bun run eval:researcher --manifest=/app/evals/lifecycle/questions.json --repeat=3 --concurrency=3 --tag=lifecycle
  podman run --rm -v "${CHRONICLER_PROJECT}_data:/data:ro" -v "$pilot_root/reports:/reports" docker.io/oven/bun:1.4.2 \
    bun -e 'await Bun.write("/reports/heldout-summary.json",await Bun.file("/data/evaluations/researcher/lifecycle/summary-summary.json").text())'
fi
