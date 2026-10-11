#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
evaluation="${1:?Choose researcher, interpreter:video, interpreter:documents, organization, memory:integrity, import:recordings or import:documents}"
shift
case "$evaluation" in
  researcher|interpreter:video|interpreter:documents|organization|memory:integrity) evaluation_command="eval:$evaluation";;
  import:recordings|import:documents) evaluation_command="$evaluation";;
  *) echo 'Unknown evaluation' >&2; exit 1;;
esac
evaluation_project="${CHRONICLER_PROJECT:-chronicler}"
[[ "$evaluation_project" =~ ^[a-z][a-z0-9_-]+$ ]] || exit 1
evaluation_mount="${CHRONICLER_DATA_MOUNT:-$PWD/data}"
podman build --target development -t localhost/chronicler-web:checks -f infra/web.Containerfile . >/dev/null
podman run --rm --network "${evaluation_project}_default" --env-file .env \
  -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler \
  -v "$evaluation_mount:/data" localhost/chronicler-web:checks bun run "$evaluation_command" "$@"
