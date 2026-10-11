#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_project="${CHRONICLER_PROJECT:-chronicler}"
[[ "$backup_project" =~ ^[a-z][a-z0-9_-]+$ ]] || exit 1
backup_destination="${1:-$PWD/data/backups/$(date -u +%Y%m%dT%H%M%SZ)}"
[[ ! -e "$backup_destination" ]] || { echo 'Backup destination must be new' >&2; exit 1; }
mkdir -p "$backup_destination"
backup_destination="$(realpath "$backup_destination")"
backup_mount="${CHRONICLER_DATA_MOUNT:-$PWD/data}"
backup_network="${backup_project}_default"
backup_database="${backup_project}_database_1"
backup_running=()
podman build --target tooling -t localhost/chronicler-tools:local -f infra/web.Containerfile . >/dev/null
for service in web worker translator media; do
  container="${backup_project}_${service}_1"
  if [[ "$(podman inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" == true ]]; then backup_running+=("$container"); fi
done
resume_writers() { if (( ${#backup_running[@]} )); then podman start "${backup_running[@]}" >/dev/null; fi; }
trap resume_writers EXIT
if (( ${#backup_running[@]} )); then podman stop -t 45 "${backup_running[@]}" >/dev/null; fi
podman exec "$backup_database" pg_dump -U chronicler -d chronicler -Fc > "$backup_destination/database.dump"
podman run --rm -v "$backup_mount:/data:ro" -v "$backup_destination:/backup" docker.io/oven/bun:1.4.2 sh -c 'set -eu; cd /data; set --; for path in assets runs transcripts document-reviews; do if [ -d "$path" ]; then set -- "$@" "$path"; fi; done; if [ "$#" -gt 0 ]; then tar -cf /backup/evidence.tar "$@"; else tar -cf /backup/evidence.tar -T /dev/null; fi'
podman run --rm --network "$backup_network" -e "DATABASE_URL=postgres://chronicler:local-only@${backup_database}:5432/chronicler" -e "APPLICATION_COMMIT=$(git rev-parse HEAD)" -v "$backup_mount:/data:ro" -v "$backup_destination:/backup" localhost/chronicler-tools:local bun apps/web/tools/backup.ts create /backup
echo "Backup ready: $backup_destination"
