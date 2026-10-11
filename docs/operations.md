# Running and recovering the local workspace

Keep credentials in private `.env`; use `.env.example` for supported settings. Bun 1.4.2, rootless Podman, the pinned Compose provider, and NVIDIA CDI are prerequisites. Services use private container networking; the web app binds loopback only.

```sh
./infra/dev.sh up -d --build
./infra/doctor.sh --live
```

The doctor checks the migrated schema, web, media and model configuration without printing credentials. `--live` makes one small model request and records its usage. Open <http://localhost:5173>. The **Operations** link shows today's model requests and configured limits. If changing the public development origin, set `CHRONICLER_ORIGIN` before rebuilding: SvelteKit 3 compiles its canonical form origin into the image. Isolated workspaces build an image for their selected localhost port automatically.

For a rebuild of an existing stack, build first, then recreate the whole stack. This avoids Podman Compose's dependent-container replacement failure:

```sh
./infra/dev.sh build web
./infra/dev.sh down
./infra/dev.sh up -d
```

`down` preserves the database and evidence/cache volumes. Never add `-v` during routine rebuilds. Media dependencies remain in the separate Python/GPU image. A new machine needs the original ignored evidence files or a verified backup; Git alone does not contain research data.

## Cancellation, retries and restarts

Use **Cancel processing** in staging, **Cancel push** on a push, or **Cancel** on a question. Cancellation prevents publication of new results and retains raw files, earlier revisions, pinned selections and checkpoints. A local GPU window already executing may finish and cache its transcript after cancellation; HTTP cancellation cannot forcibly interrupt CUDA inference safely. A completed publication wins a simultaneous cancellation and remains accepted.

Retrying an interpretation creates a new candidate revision. Retrying a push keeps the exact source revision selection; retrying a question keeps its original memory snapshot. Queued cancellation/retry gets a fresh queue delivery. Completed operations and unchanged repushes remain idempotent.

Workers hold PostgreSQL session leases while processing. Startup and the 30-second reconciliation loop requeue processing records whose owner disappeared, retaining checkpoints. Active leases are left alone; abandoned jobs do not wait for the old queue expiry. Failed terminal operations remain visibly retryable. Memory publication is one transaction; retrieval reads committed SQL snapshots, so there is no separately writable search index to repair after a commit.

## Model usage

Defaults per worker operation are 300 HTTP attempts, 2,000,000 input tokens and 200,000 output tokens. The daily ceiling defaults to disabled for the self-hosted gateway. Configure `LLM_MAX_CALLS_PER_OPERATION`, `LLM_MAX_INPUT_TOKENS_PER_OPERATION`, `LLM_MAX_OUTPUT_TOKENS_PER_OPERATION` and optional `LLM_DAILY_TOKEN_LIMIT` in `.env`, then recreate workers. Zero disables the corresponding ceiling. Researcher also retains its tighter tool/round/evidence limits.

Preflight reservations are serialized across workers and shared by retries of the same operation. Input allowance uses one token per serialized character plus 4,096 per image; this is an estimate, not a model tokenizer or a guarantee of exact provider usage. Output reserves the requested maximum. Returned provider usage replaces estimates; missing usage, interrupted requests and unknown outcomes retain their reservations. SDK HTTP retries count separately. A new explicitly requested interpretation is a new operation; a push/question retry preserves its operation ID and budget.

The ledger records operation identity, model, request hash, timing and usage, without prompts, image payloads or API credentials. Model/prompt provenance remains on revisions and accepted records. Optional `LLM_INPUT_USD_PER_MILLION` and `LLM_OUTPUT_USD_PER_MILLION` provide API prices; absent prices mean unknown monetary cost. Self-hosted token counts do not measure electricity or hardware cost. Standalone evaluation tools report their own usage; the worker ledger covers production operations and the live doctor check.

## Backup and restore

Stop manual import/evaluation commands before backing up. The backup command stops running web, workers and media to take a consistent database/evidence snapshot, then restores their previous running state even if backup fails. The destination must be new.

```sh
./infra/backup.sh data/backups/my-workspace
./infra/restore.sh data/backups/my-workspace chronicler_restored 5175
```

A backup contains a PostgreSQL custom dump, an evidence/checkpoint archive and a checksum manifest with the application commit, asset inventory, record counts and memory version. All content-addressed assets are included: original uploads, cited frames/slides, manifests, corrections, accepted history, answers and translations. Raw import duplicates, rebuildable audio, downloaded model caches and evaluation reports are excluded. Protect the backup as private research data. Checksums detect corruption; they do not authenticate a backup from an untrusted party.

Restore refuses existing target volumes, validates archive checksums and paths, restores into fresh named volumes, then checks every evidence hash and the database inventory/counts/version. By default only the database and a web service start, with a visible inspection banner and rejected mutations. This keeps restored pending jobs from immediately calling models.

To resume an already inspected restore:

```sh
CHRONICLER_PROJECT=chronicler_restored CHRONICLER_PORT=5175 ./infra/isolated.sh down
CHRONICLER_PROJECT=chronicler_restored CHRONICLER_PORT=5175 CHRONICLER_READ_ONLY=0 ./infra/isolated.sh up -d
```

Alternatively pass `--resume` as the fourth restore argument to start the writable stack immediately. Completed answers/history stay frozen; interrupted operations resume through the same lease recovery. An interrupted restore leaves its new volumes for inspection; it never overwrites them on retry. Choose a new target name after correcting a failure.

For an isolated workspace backup, provide its named evidence volume explicitly:

```sh
CHRONICLER_PROJECT=chronicler_restored CHRONICLER_DATA_MOUNT=chronicler_restored_data ./infra/backup.sh data/backups/restored-workspace
```

## Maintained verification

```sh
./infra/test-operations.sh
CHRONICLER_PROJECT=chronicler_pilot CHRONICLER_PORT=5174 ./infra/verify-mvp.sh
```

The live pilot requires the supplied recordings/documents in ignored `data/recordings` and `data/documents`. It creates a fresh database/evidence volume and runs `bun run verify:mvp` inside Podman. It uploads a real five-minute meeting excerpt and full PPTX, reviews staging, pushes, asks, follows citations, corrects speech punctuation, proves memory unchanged, repushes and checks historical answers. It then admits two documents held out from memory development. Results remain private under `data/evaluations/lifecycle/<workspace>/reports`; the pilot workspace remains available on its selected port. It does not modify the main workspace's accepted memory. Holdout question definitions live under `evals/lifecycle`, outside release images; independent human quality review remains distinct from same-model scoring.
