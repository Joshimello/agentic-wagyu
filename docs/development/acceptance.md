# Implementation acceptance evidence

## Foundation and durable uploads

M0 and M1 were accepted on 2026-10-04. Contract tests cover invalid locators/references, immutable revision selection, partial coverage acknowledgment, state transitions, and committed query scope. Disposable PostgreSQL tests cover migrations, immutable bytes with distinct upload metadata, visible unsupported-source failures, crash/restart and outbox dispatch, concurrent corrections, and concurrent retry clicks. Uploading or interpreting evidence cannot publish memory.

Runtime uses Bun 1.4.2, locked dependencies, rootless Podman, PostgreSQL/pgvector, and the official OpenAI-compatible SDK against the configured self-hosted model. The pinned MOSS runtime is PyTorch 2.9.0+cu128, Transformers 5.6.0, BF16/SDPA on GPU 0. Model: `OpenMOSS-Team/MOSS-Transcribe-Diarize`; model revision: `704aa4a9c304e8520be88901e0d1960158ef5b15`; runtime revision: `61bc29cd4120be7b5d3b761b64cd5dff57263642`.

## Real meeting staging

On 2026-10-05 the user replaced the generated-media pilot with three supplied recordings: `2026-09-08.mp4`, `2026-09-15.mp4`, and `2026-09-22.mp4`. Their verified container durations are 3,904,107; 9,407,851; and 6,567,400 milliseconds. All contain audio and video. Source hashes and user-provided language/participant context are in `evals/meetings.json`.

Twenty development uploads and their synthetic staging records, generated pilot media, and temporary reports were removed after verifying that the workspace contained no accepted memory or other uploads. Original supplied footage, database/model-cache volumes, migrations, and lasting regression coverage were preserved. Subsequent checks on real evidence must not modify its spoken text or metadata merely to test corrections.

Long meetings now use contiguous three-minute ASR sections with atomic checkpoints, original-video timestamp offsets, bounded visual-agent context, and keyframe seeking for contact sheets. Speaker IDs are scoped by section and are not added up as distinct participants. The worker's two-hour job lease accommodates long recordings; failure retries resume completed sections within the same run. An explicit reprocess creates a new run and revision.

The maintained Bun regressions passed with section coverage, offset, local speaker identity, missing/incompatible checkpoints, and out-of-section ASR interval checks. Five Python media checks passed using real recording frames/audio: malformed asset/frame requests, variable presentation timestamps, delayed audio, and seeking into the middle/end of a long video. Podman type checking reported zero errors or warnings. The final real-corpus results are recorded below.

Transcription and speaker accuracy are pending human reference annotations. The retired artificial speaker-count threshold no longer blocks this corpus, but successful end-to-end staging must not be described as verified diarization accuracy. See `pilot-scope.md` for the replacement evaluation policy.

## Completed corpus checks (2026-10-05)

All three supplied uploads are `ready_with_warnings` and can be reviewed at http://localhost:5173. The latest revisions passed the read-only live application evaluation: full recording duration, valid staging manifests and references, accessible JPEG frames, pinned JSON export, portable offline ZIP, original-video range handling, and zero memory commits.

| Recording | Duration | Speech segments | Referenced frames | Visual annotations | Audio sections | GPU inference seconds | Peak allocated GiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-08.mp4 | 65 min | 815 | 8 | 8 | 22 | 165.63 | 2.13 |
| 2026-09-15.mp4 | 157 min | 2,069 | 7 | 8 | 53 | 421.93 | 2.17 |
| 2026-09-22.mp4 | 109 min | 1,475 | 8 | 8 | 37 | 300.65 | 2.14 |

No section hit the generation limit. Inference time is the sum for the sections used by each final revision, excluding audio normalization, visual API calls, startup, waiting, and prior attempts. Allocated GPU memory is the PyTorch metric, not total device reservation. Section-level observations and warnings are retained locally in ignored `data/evaluations/meetings.json`; the small maintained corpus manifest contains only source hashes, durations, and evaluation context.

Twenty Bun regression tests (99 assertions), five real-footage Python media regressions, and three browser checks passed in Podman. The three browser checks also passed against the rebuilt release image with a read-only data mount. Type checking reported zero errors/warnings; frozen Bun and Python dependency builds succeeded. Release inspection confirmed that API secrets, private recordings, evaluation data, and test code are absent from the web release image. Importing the corpus a second time created no duplicate uploads.

Container restarts during September 8 and September 15 transcription resumed saved audio sections. September 8's first visual interpretation failed validation; a normal reprocess published a new revision with eight annotations and retained the earlier failed visual revision in history. Visual generation now permits at most eight concise annotations, has a 4,096-token output budget, and retries one failed enrichment attempt before publishing a visible partial result. Model/prompt provenance distinguishes the earlier `visual-1` candidate from `visual-2`. Worker orchestration waits for media health and grants 45 seconds for shutdown, exceeding the worker's 30-second graceful queue shutdown.

Application behavior is accepted on this corpus. Chinese transcription accuracy, speaker separation accuracy, phrase coverage at audio-section boundaries, and speaker identity across sections remain unverified until reviewed against human reference annotations. Automatic label counts are observations, not a count of meeting participants.
