# Clean release verification

Recorded 2026-10-11. M8 cleanup and functional release verification are complete. The verified implementation is commit `520cd8c`; final documentation and screenshot-probe removal are recorded afterward. Independent human transcription, organization and answer-quality acceptance remains pending.

## Cleanup

One Podman launcher now covers unit, integration, document, media, browser, type-check and build modes. Every integration suite gets its own disposable database and Bun process on a separate test PostgreSQL server. Lasting isolation, revision pinning, retry/idempotency, history, citation, translation and migration-upgrade checks remain.

Maintained corpus/model evaluations live under `evals/`, separate from operational tools and product workers. Removed scaffolding includes the one-off legacy weekly assertion replay, redundant API probe, seven duplicate test launchers, retired Docling comparison environment and three unasserted screenshot probes. Cross-language JSON Schema validation remains a development dependency in the Python check image. The screenshots' interaction/source assertions remain covered.

Production Compose uses Bun and Python runtime targets. Development and operational tooling images are separate; doctor, backup and restore no longer depend on host JavaScript packages. Image inventories exclude credentials, research files, tests, browser tooling, evaluations, plans, development history and reports, while requiring workers, migrations and recovery code. Active runtime/scripts/contributor commands contain no milestone selectors or references to removed files. Historical commands remain in development history.

Generated build/test logs, standalone schema exports, browser results, host dependency/build directories and active evaluation reports were removed. Useful observations are archived privately under ignored `data/backups/evaluation-history-20261011T151103Z.tar.gz`; original evidence, accepted memory, saved answers, checkpoints, model caches, migrations and provenance remain. New verification reports are removed from active paths after recording these findings.

The final workflow, check logs and media fingerprints are retained privately in `data/backups/release-verification-20261011.tar.gz`, outside release images. The temporary checkout and its copied credentials/input files were removed after verification.

## Retained verification

All execution used Podman and frozen dependencies.

| Check | Result |
| --- | --- |
| Unit regressions | 80 tests, 375 assertions |
| Seven isolated PostgreSQL suites | 50 tests, 301 assertions |
| Real PPTX/PDF/image integration | 3 tests, 58 assertions |
| Python media/schema edge cases | 17 tests |
| Chromium workflow | 25 tests |
| Svelte/TypeScript | Zero errors and warnings |
| Application/runtime builds and release exclusions | Passed |
| Maintained source checks | Three recordings, eight documents and 769 legacy citations resolve |

All 133 lasting Bun cases pass without the earlier skipped integration cases. The relocated Researcher runner also completed five discovery cases against main snapshot 13 in retrieval-only mode, without generation or memory changes. That verifies runner/import/manifest paths; it is not a new semantic benchmark. Final browser checks use a writable restored corpus workspace, keeping subsequent test submissions away from daily-use history.

## Clean-checkout lifecycle

A detached checkout of `520cd8c`, without host dependencies or build output, rebuilt runtime images with frozen installs. Fresh `chronicler_release_workflow` volumes received a real five-minute meeting excerpt, the 36-slide July deck, the 28-slide subcontract deck and the 13-page midterm PDF. The self-contained check image ran `bun run test:workflow`.

The runner passed **149 checks in 584.942 seconds** (9 minutes 44.942 seconds, excluding builds). Checks cover original byte hashes, staging isolation, pinned explicit admission, cited answers, an actual web/worker restart, preserved memory/answers after restart, correction, repush, historical citations and unchanged-repush deduplication. Final snapshot 3 has two projects, eight topics, four current sources and 34 current segments. Model-generated grouping counts vary; semantic quality remains human-unreviewed.

Production usage was 130 HTTP attempts, all measured: 1,012,991 input and 72,553 output tokens. No prices were configured, so monetary cost is unknown. This is a functional release observation, not a controlled latency comparison or SLA.

The main web image is `4e14607849072bdc9586df189dac5c7471bdb4f2f3eb281c6222537dbf754b26`; media is `39d7c062de24613c83177ea852a926f11c7ef67584b8a23ddf79d2038fe99e1d`. The isolated web image has its own compiled canonical origin. Its media container started before the clean-checkout media rebuild finished; both media images have identical source/lockfile fingerprints and installed runtime dependency versions. Main runs the rebuilt images, and health, Operations, Memory, Ask and the live model doctor pass.

## Preservation and restore

Main remains at accepted snapshot 13 with 1,130 assets. Exact fingerprints preserve evidence, typed memory, summary nodes/versions and translations. All 15 questions present at the verification baseline retain identical rows; one later browser submission adds an empty-snapshot question. Browser probes remain saved application history and cannot publish memory.

The new `data/backups/clean-release-original-20261011` backup is 920,285,878 bytes. Cleaned tooling restored it into new `chronicler_clean_restore` volumes, verified every archived asset and database inventory, and passed **2,173 reference checks**: 1,130 assets, 13 commits, 769 legacy citations, 163 node versions, 16 saved answers and 53 answer citations. Inspection-only mutation rejection passed before resuming that copy for final browser checks. No original evidence or accepted state was replaced.

Temporary verification stacks are stopped after use with their data volumes preserved. Main remains at <http://localhost:5173>. Current commands are in [testing](testing.md), [evaluations](../../evals/README.md) and [operations](../operations.md). Human semantic review remains separate from this completed cleanup/release milestone.
