#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
doctor_project="${CHRONICLER_PROJECT:-chronicler}"
[[ "$doctor_project" =~ ^[a-z][a-z0-9_-]+$ ]] || exit 1
podman run --rm --network "${doctor_project}_default" --env-file .env \
  -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler \
  -v "$PWD:/app:ro" -w /app docker.io/oven/bun:1.4.2 bun apps/web/tools/doctor.ts "$@"
