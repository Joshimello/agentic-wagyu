#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export CHRONICLER_PROJECT="${CHRONICLER_PROJECT:-chronicler_finals}"
export CHRONICLER_PORT="${CHRONICLER_PORT:-5178}"
# The public origin is deployment-specific: set CHRONICLER_ORIGIN in the environment
# or in the untracked infra/tailnet.env (one line: CHRONICLER_ORIGIN=https://...).
if [[ -z "${CHRONICLER_ORIGIN:-}" && -f infra/tailnet.env ]]; then . infra/tailnet.env; fi
export CHRONICLER_ORIGIN="${CHRONICLER_ORIGIN:-}"
export CHRONICLER_WEB_IMAGE="${CHRONICLER_WEB_IMAGE:-localhost/chronicler-web:$CHRONICLER_PROJECT}"
export CHRONICLER_TAILSCALE_HOSTNAME="${CHRONICLER_TAILSCALE_HOSTNAME:-chronicler-finals}"
export PODMAN_COMPOSE_PROVIDER="${PODMAN_COMPOSE_PROVIDER:-$HOME/.local/bin/podman-compose}"

[[ "$CHRONICLER_PROJECT" =~ ^[a-z][a-z0-9_-]+$ && "$CHRONICLER_PROJECT" != chronicler ]] || {
  echo 'Choose a separate finals workspace name' >&2; exit 1;
}
[[ "$CHRONICLER_PORT" =~ ^[0-9]+$ ]] && (( CHRONICLER_PORT >= 1024 && CHRONICLER_PORT <= 65535 )) || exit 1
[[ "$CHRONICLER_ORIGIN" =~ ^https://[^/?#[:space:]]+$ ]] || {
  echo 'Set CHRONICLER_ORIGIN to the exact public HTTPS origin, without a path or trailing slash' >&2; exit 1;
}

if [[ "${1:-}" == init-secret ]]; then
  secret_name=chronicler-finals-tailscale-auth
  if podman secret inspect "$secret_name" >/dev/null 2>&1; then
    echo "Enrollment secret already exists: $secret_name" >&2; exit 1
  fi
  trap 'unset tailnet_join_key' EXIT
  IFS= read -r -s -p 'Lab tailnet join key (hidden): ' tailnet_join_key
  printf '\n' >&2
  [[ "$tailnet_join_key" == tskey-auth-* ]] || {
    echo 'Expected a Tailscale enrollment key' >&2; exit 1;
  }
  printf '%s' "$tailnet_join_key" | podman secret create "$secret_name" -
  exit
fi

[[ -x "$PODMAN_COMPOSE_PROVIDER" ]] || {
  echo 'Install the pinned compose launcher: uv tool install podman-compose==1.5.0' >&2; exit 1;
}
[[ -f .env ]] || { echo 'Create the private application .env before deployment' >&2; exit 1; }
mkdir -p data/cache
exec podman compose --env-file .env -p "$CHRONICLER_PROJECT" \
  -f infra/isolated.compose.yaml -f infra/tailnet.compose.yaml "$@"
