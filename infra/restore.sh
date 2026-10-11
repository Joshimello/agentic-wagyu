#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $# -ge 2 ]] || { echo 'Usage: restore.sh BACKUP_DIRECTORY NEW_WORKSPACE [PORT] [--resume]' >&2; exit 1; }
restore_source="$(realpath "$1")"
export CHRONICLER_PROJECT="$2" CHRONICLER_PORT="${3:-5174}" CHRONICLER_READ_ONLY=1
[[ "$CHRONICLER_PROJECT" =~ ^[a-z][a-z0-9_-]+$ && "$CHRONICLER_PROJECT" != chronicler && "$CHRONICLER_PORT" =~ ^[0-9]+$ ]] || exit 1
(( CHRONICLER_PORT >= 1024 && CHRONICLER_PORT <= 65535 )) || exit 1
for volume in "${CHRONICLER_PROJECT}_database" "${CHRONICLER_PROJECT}_data"; do
  if podman volume exists "$volume"; then echo "Restore requires new volumes: $volume" >&2; exit 1; fi
done
if podman container exists "${CHRONICLER_PROJECT}_database_1"; then echo 'Workspace already exists' >&2; exit 1; fi
podman build --target tooling -t localhost/chronicler-tools:local -f infra/web.Containerfile . >/dev/null
podman run --rm -v "$restore_source:/backup:ro" localhost/chronicler-tools:local bun apps/web/tools/backup.ts verify /backup
# Reject archive links and paths outside the evidence/checkpoint roots.
podman run --rm -v "$restore_source:/backup:ro" docker.io/oven/bun:1.4.2 bash -c 'set -euo pipefail; tar -tf /backup/evidence.tar | awk '\''/^\// || /(^|\/)\.\.(\/|$)/ || !/^(assets|runs|transcripts|document-reviews)\// {bad=1} END {exit bad}'\''; tar -tvf /backup/evidence.tar | awk '\''substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}'\'''
./infra/isolated.sh up -d database
podman volume create "${CHRONICLER_PROJECT}_data" >/dev/null
restore_database="${CHRONICLER_PROJECT}_database_1"
for attempt in {1..30}; do if podman exec "$restore_database" pg_isready -U chronicler >/dev/null; then break; fi; sleep 1; done
podman exec -i "$restore_database" pg_restore -U chronicler -d chronicler --exit-on-error --no-owner --no-privileges < "$restore_source/database.dump"
podman run --rm -v "${CHRONICLER_PROJECT}_data:/data" -v "$restore_source:/backup:ro" docker.io/oven/bun:1.4.2 tar --no-same-owner --no-same-permissions -C /data -xf /backup/evidence.tar
podman run --rm --network "${CHRONICLER_PROJECT}_default" -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "${CHRONICLER_PROJECT}_data:/data:ro" -v "$restore_source:/backup:ro" localhost/chronicler-tools:local bun apps/web/tools/backup.ts verify-database /backup
if [[ "${4:-}" == --resume ]]; then
  export CHRONICLER_READ_ONLY=0
  ./infra/isolated.sh up -d
else
  ./infra/isolated.sh up -d web
fi
echo "Restored workspace: http://localhost:$CHRONICLER_PORT (name: $CHRONICLER_PROJECT)"
