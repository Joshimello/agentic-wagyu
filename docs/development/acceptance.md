# Implementation acceptance evidence

## Foundation and durable uploads

M0 and M1 were accepted on 2026-10-04. Contract tests cover invalid locators/references, immutable revision selection, partial coverage acknowledgment, state transitions, and committed query scope. Disposable PostgreSQL tests cover migrations, immutable bytes with distinct upload metadata, visible unsupported-source failures, crash/restart and outbox dispatch, concurrent corrections, and concurrent retry clicks. Uploading or interpreting evidence cannot publish memory.

Runtime uses Bun 1.4.2, locked dependencies, rootless Podman, PostgreSQL/pgvector, and the official OpenAI-compatible SDK against the configured self-hosted model. The pinned MOSS runtime is PyTorch 2.9.0+cu128, Transformers 5.6.0, BF16/SDPA on GPU 0. Model: `OpenMOSS-Team/MOSS-Transcribe-Diarize`; model revision: `704aa4a9c304e8520be88901e0d1960158ef5b15`; runtime revision: `61bc29cd4120be7b5d3b761b64cd5dff57263642`.

## Real meeting staging

On 2026-10-05 the user replaced the generated-media pilot with three supplied recordings: `2026-09-08.mp4`, `2026-09-15.mp4`, and `2026-09-22.mp4`. Their verified container durations are 3,904,107; 9,407,851; and 6,567,400 milliseconds. All contain audio and video. Source hashes and user-provided language/participant context are in `evals/meetings.json`.

Twenty development uploads and their synthetic staging records, generated pilot media, and temporary reports were removed after verifying that the workspace contained no accepted memory or other uploads. Original supplied footage, database/model-cache volumes, migrations, and lasting regression coverage were preserved. Subsequent checks on real evidence must not modify its spoken text or metadata merely to test corrections.

Long meetings now use contiguous three-minute ASR sections with atomic checkpoints, original-video timestamp offsets, bounded visual-agent context, and keyframe seeking for contact sheets. Speaker IDs are scoped by section and are not added up as distinct participants. The worker's two-hour job lease accommodates long recordings; failure retries resume completed sections within the same run. An explicit reprocess creates a new run and revision.

The maintained Bun regressions passed with section coverage, offset, local speaker identity, missing/incompatible checkpoints, and out-of-section ASR interval checks. Five Python media checks passed using real recording frames/audio: malformed asset/frame requests, variable presentation timestamps, delayed audio, and seeking into the middle/end of a long video. Podman type checking reported zero errors or warnings. Final real-corpus application, browser, timing, and speaker observations are recorded below when available.

Transcription and speaker accuracy are pending human reference annotations. The retired artificial speaker-count threshold no longer blocks this corpus, but successful end-to-end staging must not be described as verified diarization accuracy. See `pilot-scope.md` for the replacement evaluation policy.
