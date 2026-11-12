#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./infra/tailnet.sh up -d

# Keep WSL active after the detached containers have started.
exec /bin/sleep infinity
