#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CHRONICLER_PROJECT:?Set a separate workspace name}"
[[ "$CHRONICLER_PROJECT" =~ ^[a-z][a-z0-9_-]+$ && "$CHRONICLER_PROJECT" != chronicler ]] || { echo 'Choose a distinct workspace name' >&2; exit 1; }
export PODMAN_COMPOSE_PROVIDER="${PODMAN_COMPOSE_PROVIDER:-$HOME/.local/bin/podman-compose}"
export CHRONICLER_PORT="${CHRONICLER_PORT:-5174}"
[[ "$CHRONICLER_PORT" =~ ^[0-9]+$ ]] && (( CHRONICLER_PORT >= 1024 && CHRONICLER_PORT <= 65535 )) || exit 1
export CHRONICLER_WEB_IMAGE="${CHRONICLER_WEB_IMAGE:-localhost/chronicler-web:local-$CHRONICLER_PORT}"
if [[ "${1:-}" == up ]]; then
  # SvelteKit 3 compiles its canonical form origin into the build.
  podman build --target runtime --build-arg "APP_ORIGIN=http://localhost:$CHRONICLER_PORT" -t "$CHRONICLER_WEB_IMAGE" -f infra/web.Containerfile .
fi
podman compose --env-file .env -p "$CHRONICLER_PROJECT" -f infra/isolated.compose.yaml "$@"
