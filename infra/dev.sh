#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PODMAN_COMPOSE_PROVIDER="${PODMAN_COMPOSE_PROVIDER:-$HOME/.local/bin/podman-compose}"
if [[ ! -x "$PODMAN_COMPOSE_PROVIDER" ]]; then
  echo 'Install the pinned compose launcher: uv tool install podman-compose==1.5.0' >&2; exit 1
fi
mkdir -p data/cache
podman compose -f infra/compose.yaml "$@"
