# Implementation acceptance evidence

## Foundation and durable uploads

M0 and M1 were accepted on 2026-10-04. Contract tests cover invalid locators/references, immutable revision selection, partial coverage acknowledgment, state transitions, and committed query scope. Disposable PostgreSQL tests cover migrations, immutable bytes with distinct upload metadata, visible unsupported-source failures, crash/restart and outbox dispatch, concurrent corrections, and concurrent retry clicks. Uploading or interpreting evidence cannot publish memory.

Runtime uses Bun 1.4.2, locked dependencies, rootless Podman, PostgreSQL/pgvector, and the official OpenAI-compatible SDK against the configured self-hosted model. The pinned MOSS runtime is PyTorch 2.9.0+cu128, Transformers 5.6.0, BF16/SDPA on GPU 0. Model: `OpenMOSS-Team/MOSS-Transcribe-Diarize`; model revision: `704aa4a9c304e8520be88901e0d1960158ef5b15`; runtime revision: `61bc29cd4120be7b5d3b761b64cd5dff57263642`.

## Real meeting staging

On 2026-10-05 the user replaced the generated-media pilot with three supplied recordings: `2026-09-08.mp4`, `2026-09-15.mp4`, and `2026-09-22.mp4`. Their verified container durations are 3,904,107; 9,407,851; and 6,567,400 milliseconds. All contain audio and video. Source hashes and user-provided language/participant context are in `evals/meetings.json`.

Twenty development uploads and their synthetic staging records, generated pilot media, and temporary reports were removed after verifying that the workspace contained no accepted memory or other uploads. Original supplied footage, database/model-cache volumes, migrations, and lasting regression coverage were preserved. Subsequent checks on real evidence must not modify its spoken text or metadata merely to test corrections.

The initial corpus baseline used contiguous three-minute ASR sections with atomic checkpoints, original-video timestamp offsets, bounded visual-agent context, and keyframe seeking for contact sheets. Speaker IDs are scoped by section and are not added up as distinct participants. The worker's two-hour job lease accommodates long recordings; failure retries resume completed sections within the same run. An explicit reprocess creates a new run and revision.

The maintained Bun regressions passed with section coverage, offset, local speaker identity, missing/incompatible checkpoints, and out-of-section ASR interval checks. Five Python media checks passed using real recording frames/audio: malformed asset/frame requests, variable presentation timestamps, delayed audio, and seeking into the middle/end of a long video. Podman type checking reported zero errors or warnings. The final real-corpus results are recorded below.

Transcription and speaker accuracy are pending human reference annotations. The retired artificial speaker-count threshold no longer blocks this corpus, but successful end-to-end staging must not be described as verified diarization accuracy. See `pilot-scope.md` for the replacement evaluation policy.

## Initial corpus baseline checks (2026-10-05)

All three supplied uploads are `ready_with_warnings` and can be reviewed at http://localhost:5173. The latest revisions passed the read-only live application evaluation: full recording duration, valid staging manifests and references, accessible JPEG frames, pinned JSON export, portable offline ZIP, original-video range handling, and zero memory commits.

| Recording | Duration | Speech segments | Referenced frames | Visual annotations | Audio sections | GPU inference seconds | Peak allocated GiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-08.mp4 | 65 min | 815 | 8 | 8 | 22 | 165.63 | 2.13 |
| 2026-09-15.mp4 | 157 min | 2,069 | 7 | 8 | 53 | 421.93 | 2.17 |
| 2026-09-22.mp4 | 109 min | 1,475 | 8 | 8 | 37 | 300.65 | 2.14 |

No section hit the generation limit. Inference time is the sum for the sections used by each final revision, excluding audio normalization, visual API calls, startup, waiting, and prior attempts. Allocated GPU memory is the PyTorch metric, not total device reservation. Section-level observations and warnings are retained locally in ignored `data/evaluations/meetings.json`; the small maintained corpus manifest contains only source hashes, durations, and evaluation context.

Twenty Bun regression tests (99 assertions), five real-footage Python media regressions, and three browser checks passed in Podman. The three browser checks also passed against the rebuilt release image with a read-only data mount. Type checking reported zero errors/warnings; frozen Bun and Python dependency builds succeeded. Release inspection confirmed that API secrets, private recordings, evaluation data, and test code are absent from the web release image. Importing the corpus a second time created no duplicate uploads.

Container restarts during September 8 and September 15 transcription resumed saved audio sections. September 8's first visual interpretation failed validation; a normal reprocess published a new revision with eight annotations and retained the earlier failed visual revision in history. The initial visual generation permitted at most eight concise annotations, had a 4,096-token output budget, and retried one failed enrichment attempt before publishing a visible partial result. Model/prompt provenance distinguishes the earlier `visual-1` candidate from `visual-2`. Worker orchestration waits for media health and grants 45 seconds for shutdown, exceeding the worker's 30-second graceful queue shutdown.

Application behavior is accepted on this corpus. Chinese transcription accuracy, speaker separation accuracy, phrase coverage at audio-section boundaries, and speaker identity across sections remain unverified until reviewed against human reference annotations. Automatic label counts are observations, not a count of meeting participants.

## Transcript-led visual research and continuous ASR follow-up

The user observed that the original visual agent was describing sampled frames rather than resolving missing context. The implementation indeed sampled at most 120 transcript segments and instructed beginning/middle/end sampling. This was replaced with full, contiguous transcript reading, structured context questions, targeted searches within 90 seconds of cited speech, and explicit unanswered/deferred questions. The stage contract remains backward compatible and now carries question/search evidence, tentative speaker names, and transcription run/window provenance. A migrated nullable input revision pins visual-only jobs.

The new viewer/export presents the questions and search reasons, source frames, and unverified candidate names. Names require cited speech belonging to the anonymous speaker and never rename/merge speaker codes automatically. Visual-only reprocessing preserves speech/corrections and prior revisions. Correcting supporting text invalidates name suggestions and affected context answers; concurrent corrections remain current.

Two single-call attempts on the entire 65-minute September 8 audio returned 439 segments, ended at 2,977.38 seconds, and generated 16,380 tokens. The second confirmed an explicit 65,536-token budget and a final EOS token. It took 294.35 seconds and peaked at 9.23 GiB allocated VRAM. Thus an EOS below the token ceiling is insufficient evidence of full coverage. These partial attempts did not replace the accepted full transcript. A continuous 30-minute benchmark returned 267 segments through 1,799.98 seconds, generated 9,645 tokens, took 94.77 seconds, and peaked at 5.39 GiB. The current adapter budgets output against the actual input/context length, flags a final unrepresented interval longer than 60 seconds as uncertain (silence or early stop), and automatically retries uncertain long passes in 30-minute windows. Speaker continuity across windows remains unverified. [MOSS model card](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize).

The first live full-transcript planner attempt exhausted 4,096 completion tokens on reasoning and produced no JSON. Qwen's verified `enable_thinking=false` serving option returned valid structured questions with zero reasoning tokens; the structured workflow now uses it for Qwen. Failed visual revisions remain in history and their spoken text is intact. Later successful visual reviews restore ASR coverage independently from old visual-failure notes.

Podman checks passed: 27 Bun regressions/149 assertions, seven real-footage media/generation-budget checks, and TypeScript/Svelte validation with zero errors/warnings. Coverage includes every-line reading, nearby-only frame requests, preserved speech and anonymous IDs, invalid name/frame evidence, pinned visual-only input, stale/concurrent corrections, fallback window identity scoping, and checkpoint replay. The updated corpus passed read-only evidence/export checks and three Chromium checks against development and release images. Release worker imports and secret/evidence/test exclusion also passed. Private benchmark and quality reports remain under ignored `data/evaluations/`.


The completed visual reviews preserve all 4,359 original speech primitives and their metadata. Normalization created additional immutable revisions to remove abstentions such as “unknown” from name candidates; the original model responses remain in history. These counts are suggestions tied to local speaker codes, not participant counts or verified identities.

| Recording | Transcript segments read | Context questions | Answered | Searched frames | Annotations | Usable name suggestions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-08.mp4 | 815 / 815 | 14 | 12 | 53 | 32 | 10 |
| 2026-09-15.mp4 | 2,069 / 2,069 | 30 | 23 | 95 | 68 | 20 |
| 2026-09-22.mp4 | 1,475 / 1,475 | 23 | 20 | 92 | 58 | 14 |

September 15's planner proposed 30 questions; six were deferred by the 24-question budget. All transcript segments were still read. Unanswered questions and ASR omissions remain visible. No staged material entered memory.

The production media API separately recovered the complete September 8 timeline in windows of 1,800,000; 1,800,000; and 304,107 ms. It returned 267, 438, and 71 segments, with local final ends at 1,799.98; 1,799.68; and 303.61 seconds. None were marked truncated/incomplete. Total GPU inference was 245.39 seconds; replay reused the source cache. This establishes operational timeline coverage and caching, not transcript or speaker accuracy. These measurements are preserved privately in `data/evaluations/moss-30-recovery-2026-09-08.json`. The liked, existing staged transcripts were not replaced by this new ASR output. Subsequent **Reprocess original** requests use the continuous/fallback strategy; **Revisit visual context** uses the existing transcript.

The final `context-3` schema/prompt also passed a live smoke check on 30 real September 22 utterances: all 30 were read, five targeted questions and 13 annotations were produced, no unsupported name guesses were retained, and every reference validated. Expanded release-browser checks opened the question/search and tentative-name panels, sought a question-selected timestamp, and confirmed the original speaker labels remained in the transcript.
