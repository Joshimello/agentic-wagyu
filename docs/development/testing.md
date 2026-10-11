# Maintained verification

Use `infra/test.sh` from a checkout with Podman. It builds a frozen Bun development image containing the check sources; the host needs no `node_modules`. All test servers, networks and data volumes have unique names and are removed on exit. It never drops or truncates workspace databases.

| Command | Checks and prerequisites |
| --- | --- |
| `./infra/test.sh check` | Svelte/TypeScript, including tests and workers |
| `./infra/test.sh unit` | Pure contracts, provenance, source ranges, retrieval, normalization, exports and backup manifest validation |
| `./infra/test.sh integration` | Seven independently migrated PostgreSQL suites: staging, typed memory/history, summary organization, Researcher, operation recovery/limits, translations, and both migration upgrade histories |
| `./infra/test.sh documents` | Real PPTX/PDF/image staging, native extraction, immutable revisions, caching, portable exports and memory isolation; requires `data/documents` and the media image |
| `./infra/test.sh media` | Python source timing, MOSS output budgeting, rendering/media edge cases and cross-language JSON Schema checks; requires supplied recordings/documents |
| `./infra/test.sh browser` | Chromium review/search/correction/translation, pinned selections, memory/history, Ask and source navigation; requires running workspace with the supplied staged corpus |
| `./infra/test.sh build` | Frozen Bun production application build |

Set `CHRONICLER_FIXTURE_ROOT` to another private corpus directory for document/media checks. Browser checks use `WEB_URL` (default `http://localhost:5173`) and write disposable results under `data/browser-results`. Each check image is built from the current checkout. Python test-only JSON Schema tooling lives in the `checks` image target, outside the runtime image.

Inside an already provisioned Podman check container, the stable Bun entrypoints are `bun run check`, `bun run test`, `bun run test:integration`, `bun run test:e2e` and `bun run build`. The integration runner requires `TEST_DATABASE_URL` pointing to a disposable PostgreSQL server where it can create/drop its own databases. Every suite gets a fresh database and a separate Bun process, so closed pools, queue schemas, model environment overrides and prior accepted memory cannot leak between suites. Migration tests independently reconstruct both historical branches. `--suite=operations` selects one integration suite; real-document checks use `--suite=documents` with media/fixtures provisioned by the shell launcher.

## Full release workflow

```sh
CHRONICLER_PROJECT=chronicler_workflow_example CHRONICLER_PORT=5174 ./infra/verify-workflow.sh
```

The fresh workspace receives a real five-minute excerpt and full July PPTX, followed by the subcontract deck and midterm PDF. `bun run test:workflow` verifies explicit admission, real answers and original citations, immutable correction, staging isolation, repush/history and unchanged replay. The launcher restarts web/workers after the first saved answer; the runner confirms memory and the saved answer survive. Model calls use private `.env`. The workspace remains available for inspection; repeated runner execution can use its saved report with `--resume` after a failure. Do not pass `--verify-restart` without the launcher's restart handshake.

Use a new workspace name/port for each fresh run. Set `CHRONICLER_FIXTURE_ROOT` and `CHRONICLER_CACHE_MOUNT` when checking a separate clean checkout against an existing private corpus/cache. Generated reports are private and disposable; retain reviewed findings in development history. [Evaluations](../../evals/README.md) are distinct from lasting regressions and human quality acceptance.
