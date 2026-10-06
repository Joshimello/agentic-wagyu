#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
document_database="chronicler_documents_${RANDOM}_$$"
document_media="chronicler-documents-media-$$"
document_runner="chronicler-documents-test-$$"
document_data="$PWD/data/tests/$document_database"
mkdir -p "$document_data"
cleanup() {
  podman rm -f "$document_runner" "$document_media" >/dev/null 2>&1 || true
  podman exec chronicler_database_1 dropdb --force -U chronicler "$document_database" >/dev/null 2>&1 || true
  rm -rf "$document_data"
}
trap cleanup EXIT
podman exec chronicler_database_1 createdb -U chronicler "$document_database"
podman run -d --name "$document_media" --network chronicler_default -v "$document_data:/data" -v "$PWD/data/documents:/fixtures:ro" localhost/chronicler-media:dev >/dev/null
for document_attempt in {1..15}; do
  if podman exec "$document_media" python -c 'import urllib.request; urllib.request.urlopen("http://localhost:8000/health",timeout=2)' >/dev/null 2>&1; then break; fi
  if [ "$document_attempt" = 15 ]; then podman logs "$document_media"; exit 1; fi
  sleep 1
done
podman exec "$document_media" python -c 'from pathlib import Path; from documents import render_page; import tempfile; from PIL import Image; Path("/data/input").mkdir(); tmp=tempfile.TemporaryDirectory(); image=render_page(Path("/fixtures/260629_VLM.pdf"),1,Path(tmp.name)); rotated=image.rotate(90,expand=True); exif=rotated.getexif(); exif[274]=6; rotated.save("/data/input/rotated.jpg",exif=exif); tmp.cleanup()'
podman run --rm --name "$document_runner" --network chronicler_default \
  -e "DATABASE_URL=postgres://chronicler:local-only@database:5432/$document_database" \
  -e "MEDIA_URL=http://$document_media:8000" -e DOCUMENT_FIXTURES=/fixtures \
  -e OPENAI_API_KEY= -e OPENAI_MODEL= -e OPENAI_BASE_URL= \
  -v "$PWD:/app" -v "$document_data:/data" -v "$PWD/data/documents:/fixtures:ro" -w /app docker.io/oven/bun:1.4.2 \
  sh -c 'bun run --cwd apps/web db:migrate && bun test apps/web/tests/documents.integration.test.ts'
