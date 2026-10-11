# Windows workspace merge verification

Recorded 2026-10-12. GitHub main `b2c396e` is merged with the local workspace activity, meeting summaries, cancellation/removal controls and review UI. The integration merge is `fd4cd8c`.

## Preserved behavior

The persistent header, content scrolling below it, faster page transitions, transcript beside the video, 15-line expandable meeting summary, always-visible topic/project panel and Added to memory status remain. Ask joins the existing navigation; Researcher questions participate in the activity panel with generation-checked cancellation. Operations, worker recovery, usage accounting and backup/restore tooling are retained.

Interpreter/Chronicler recovery recognizes leases from both branch implementations. Canceled or superseded work cannot publish. The translation worker retains meeting-summary dispatch and recovery. The original translation migration remains available alongside its immutable test fixture.

`0013_workspace_convergence.sql` fills features skipped by either branch's already-applied timestamps without resetting data. The journal has unique indexes in timestamp order. Fixtures exercise the research, translation, local processing-control, local workspace-activity and upstream release histories, plus fresh installation and repeated migration.

## Verification

- Svelte/TypeScript: zero errors and warnings.
- Bun unit checks: 84 passing tests, 388 assertions.
- Ten isolated PostgreSQL suites: 81 passing tests, zero failures.
- Applicable Chromium checks: 31 passing; 14 original-corpus cases unavailable on this PC.
- Consistent backup: 56 evidence assets with verified checksums; database and evidence archives retained privately under `data/backups/pre-merge-20261012`.
- Restore into fresh volumes: record counts and all asset checksums match; 93 asset, snapshot and source-reference checks pass. Inspection mode rejects writes with HTTP 403.
- Live configured-model workflow on the restored copy: unpushed source/correction exclusion, exact threshold citations, correction/repush, immutable saved answers, unchanged replay and a real-recording answer with two original citations pass.
- Bun application/runtime and Python media runtime builds use frozen dependencies. The optional `MEDIA_BASE_IMAGE` build argument can reuse an existing dependency image; `uv sync --frozen --no-dev` still enforces the current runtime environment.

The original workspace has memory version 2, 56 assets and four uploads. Live probes use only the restored workspace; its synthetic probe advances that copy to version 4. Main evidence, accepted memory, caches and history remain intact.

## Limits

The supplied legacy VLM decks/PDFs and September recordings used by the upstream corpus checks are absent locally. Those cases are explicitly skipped rather than represented as passing. Original evidence pointers and real recording review are exercised with this PC's corpus. Human transcription, speaker identity, organization and answer-support scoring remain independent semantic acceptance tasks; functional passes do not establish universal answer accuracy.
