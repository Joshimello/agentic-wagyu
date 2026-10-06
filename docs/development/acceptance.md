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

Two single-call attempts on the entire 65-minute September 8 audio returned 439 segments, ended at 2,977.38 seconds, and generated 16,380 tokens. The second confirmed an explicit 65,536-token budget and a final EOS token. It took 294.35 seconds and peaked at 9.23 GiB allocated VRAM. Thus an EOS below the token ceiling is insufficient evidence of full coverage. These partial attempts did not replace the accepted full transcript. A continuous 30-minute benchmark returned 267 segments through 1,799.98 seconds, generated 9,645 tokens, took 94.77 seconds, and peaked at 5.39 GiB. At that stage, the adapter budgeted output against the actual input/context length, flagged a final unrepresented interval longer than 60 seconds as uncertain (silence or early stop), and automatically retried uncertain long passes in 30-minute windows. Speaker continuity across windows remains unverified. [MOSS model card](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize).

The first live full-transcript planner attempt exhausted 4,096 completion tokens on reasoning and produced no JSON. Qwen's verified `enable_thinking=false` serving option returned valid structured questions with zero reasoning tokens; the structured workflow now uses it for Qwen. Failed visual revisions remain in history and their spoken text is intact. Later successful visual reviews restore ASR coverage independently from old visual-failure notes.

Podman checks passed: 27 Bun regressions/149 assertions, seven real-footage media/generation-budget checks, and TypeScript/Svelte validation with zero errors/warnings. Coverage includes every-line reading, nearby-only frame requests, preserved speech and anonymous IDs, invalid name/frame evidence, pinned visual-only input, stale/concurrent corrections, fallback window identity scoping, and checkpoint replay. The updated corpus passed read-only evidence/export checks and three Chromium checks against development and release images. Release worker imports and secret/evidence/test exclusion also passed. Private benchmark and quality reports remain under ignored `data/evaluations/`.


The completed visual reviews preserve all 4,359 original speech primitives and their metadata. Normalization created additional immutable revisions to remove abstentions such as “unknown” from name candidates; the original model responses remain in history. These counts are suggestions tied to local speaker codes, not participant counts or verified identities.

| Recording | Transcript segments read | Context questions | Answered | Searched frames | Annotations | Usable name suggestions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-09-08.mp4 | 815 / 815 | 14 | 12 | 53 | 32 | 10 |
| 2026-09-15.mp4 | 2,069 / 2,069 | 30 | 23 | 95 | 68 | 20 |
| 2026-09-22.mp4 | 1,475 / 1,475 | 23 | 20 | 92 | 58 | 14 |

September 15's planner proposed 30 questions; six were deferred by the 24-question budget. All transcript segments were still read. Unanswered questions and ASR omissions remain visible. No staged material entered memory.

The production media API separately recovered the complete September 8 timeline in windows of 1,800,000; 1,800,000; and 304,107 ms. It returned 267, 438, and 71 segments, with local final ends at 1,799.98; 1,799.68; and 303.61 seconds. None were marked truncated/incomplete. Total GPU inference was 245.39 seconds; replay reused the source cache. This establishes operational timeline coverage and caching, not transcript or speaker accuracy. These measurements are preserved privately in `data/evaluations/moss-30-recovery-2026-09-08.json`. The liked, existing staged transcripts were not replaced by this new ASR output. At that stage, **Reprocess original** used the continuous/fallback strategy; **Revisit visual context** used the existing transcript. The corpus rerun below supersedes that ASR strategy.

The final `context-3` schema/prompt also passed a live smoke check on 30 real September 22 utterances: all 30 were read, five targeted questions and 13 annotations were produced, no unsupported name guesses were retained, and every reference validated. Expanded release-browser checks opened the question/search and tentative-name panels, sought a question-selected timestamp, and confirmed the original speaker labels remained in the transcript.

## Full corpus rerun with 30-minute chunks

At the user's request on 2026-10-05, all three meetings were reprocessed and published as new current staging revisions using 30-minute windows directly. The initial 90-minute attempt is no longer part of ordinary video processing. The prior revisions remain in history. The three existing September 8 window caches were preserved in the private evaluation directory before processing; every one of the thirteen new checkpoints reports `cached: false`. MOSS weights were already loaded and normalized source audio was already cached, so these measurements exclude cold model loading and first-time audio normalization.

| Recording | Duration | Chunks | MOSS inference seconds | Enqueue-to-ready time | Peak allocated GiB |
| --- | --- | ---: | ---: | --- | ---: |
| 2026-09-08.mp4 | 65 min | 3 | 243.87 | 5 min 46 sec | 5.79 |
| 2026-09-15.mp4 | 157 min | 6 | 622.63 | 14 min 13 sec | 5.78 |
| 2026-09-22.mp4 | 109 min | 4 | 397.71 | 9 min 27 sec | 5.84 |

Inference is the sum of the model's per-window execution measurements. Enqueue-to-ready is the durable run's completion timestamp minus its creation timestamp and includes queue waiting, media requests, transcript planning, and Qwen frame research. Jobs were submitted sequentially, with roughly two seconds of dispatch waiting each. The complete sequence took about 29 minutes 27 seconds for roughly 5 hours 31 minutes of audio. Against the earlier three-minute runs, observed inference time increased by about 42% overall (32–48% per recording), while audio windows fell from 112 to 13. This is an operational comparison rather than a controlled accuracy benchmark.

No window reached the generation limit or triggered an incomplete-endpoint warning. All final transcription intervals validated. This establishes operational timeline checks, not human-verified speech coverage or speaker accuracy. Speaker codes across windows fell from 62 to 20, 138 to 30, and 93 to 23 respectively; these are anonymous codes, not counts of participants. Extracted text character counts stayed within 2% of the preceding transcripts. Matching identities between chunks remains unverified.

| Recording | Speech segments read | Answered / proposed questions | Searched frames | Annotations | Tentative names |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-09-08.mp4 | 776 / 776 | 11 / 11 | 43 | 33 | 1 |
| 2026-09-15.mp4 | 1,931 / 1,931 | 22 / 29 | 96 | 61 | 0 |
| 2026-09-22.mp4 | 1,274 / 1,274 | 19 / 20 | 80 | 55 | 1 |

All visual reviews use `context-3` and the configured `pro6000/qwen38-flash-next`. September 15 retains five deferred questions under the 24-question research limit and two other unresolved questions; September 22 retains one unresolved question. Names remain unverified, and abstention is allowed. No material entered memory.

The maintained live corpus evaluation passed reference validation, complete transcript input, checkpoint/source offsets, pinned JSON and portable ZIP exports, image access, and source byte ranges. Each of the three new reviews passed the Chromium inspection/seek/export regression in Podman. The implementation passed 27 Bun tests (150 assertions), TypeScript/Svelte checks with zero errors/warnings, frozen development/release builds, and release-worker import checks. Per-window inference measurements, progress timestamps, before/after counts, and prior cache entries remain privately under ignored `data/evaluations/thirty-minute-rerun/`; the maintained corpus report is `data/evaluations/meetings.json`.

## English reviews and Traditional Chinese transcription

On 2026-10-06, the active three-meeting corpus was refreshed with English planning/review prompts (`context-4-en`) and OpenCC standard Traditional Chinese transcription (`s2t`, pinned `opencc-js` 1.4.2). This was visual-only processing of the existing 30-minute transcripts; MOSS was not rerun. The original ASR checkpoints and earlier revisions are retained.

| Recording | Retained speech segments | Segments with script conversion | English questions | Visual annotations |
| --- | ---: | ---: | ---: | ---: |
| 2026-09-08.mp4 | 776 | 644 | 10 | 30 |
| 2026-09-15.mp4 | 1,931 | 1,642 | 32 | 65 |
| 2026-09-22.mp4 | 1,274 | 1,076 | 21 | 56 |

Every new speech primitive matches the previous primitive except for the expected OpenCC text conversion; IDs, anonymous speaker codes, roles, and media locators are unchanged. Raw aggregate ASR files passed before/after SHA-256 checks, and ASR run/window provenance is identical. Questions, search reasons, annotations, explanations, and name rationales passed the maintained English-prose checks. Chinese quotations/names use the Traditional Chinese output policy. These tests inspect prompts and observable output, not private model reasoning; the previously verified Qwen `enable_thinking=false` serving option remains in place.

Corpus validation exposed two edge cases. OpenCC's `s2t` operation is not universally idempotent on already-Traditional text: both the JavaScript library and a native OpenCC check converted a second-pass `裏面包括` to `裏麪包括`. Staging now records normalization provenance and skips repeated passes; unchanged correction fields are also preserved. Fresh ASR and changed speech corrections receive one conversion. A lasting regression covers this phrase through a revisit and unchanged save. Six September 15 model annotations contained only T references/timestamps. They were omitted in a new immutable revision, with source frames retained and affected questions left unresolved. The same validation automatically omitted four such annotations from September 22. September 15 retains eight questions deferred by the existing 24-question research budget and two other unresolved questions; September 22 retains one unresolved question.

Podman validation passed 29 Bun regressions (168 assertions), TypeScript/Svelte checks with zero errors/warnings, frozen development/release builds, release OpenCC/worker imports, all three Chromium inspection/seek/export checks, and the maintained full-corpus evidence/portable-export checks. No material entered memory. Private before/after hashes and language review observations are in ignored `data/evaluations/language-review/results.json`; the temporary driver was removed.

## Document staging and pinned selections (2026-10-06)

M3 source extraction is functionally accepted. All eight originals passed SHA-256 checks and were imported through the durable upload service; none entered memory. Initial `documents-2` revisions contain 255 page/slide renders, 1,005 native text blocks and ten separate speaker notes. One hidden slide retains its original number. Notes remain `notes`, never ASR or attributed speech. Staging views and portable exports retain every page/slide render, including diagrams, equations, charts and tables.

| Source | Pages/slides | Native blocks | Notes | Hidden | Coverage | Extract/render time |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| 260629_VLM.pptx | 38 | 80 | 4 | 0 | Partial | 5.16 s |
| 260720_VLM.pptx | 36 | 72 | 2 | 0 | Complete | 3.34 s |
| 260804_VLM.pptx | 33 | 67 | 0 | 0 | Complete | 4.36 s |
| 260629_VLM.pdf | 38 | 98 | 0 | 0 | Complete | 3.03 s |
| 260720_VLM.pdf | 36 | 108 | 0 | 0 | Complete | 1.80 s |
| 260804_VLM.pdf | 33 | 89 | 0 | 0 | Complete | 1.92 s |
| 115年度資通所分包_基於VLM的目標選取與語意標註_清大_朱宏國.pptx | 28 | 78 | 4 | 1 | Complete | 4.89 s |
| ITRI_VLM_Midterm_Report.pdf | 13 | 413 | 0 | 0 | Complete | 0.74 s |

Total extraction/render time: 25.25 seconds, excluding upload, queue waiting, registration and export. `260629_VLM.pptx` is partial because slides 17, 19, 22, 23, 25 and 26 contain animations/media/unsupported objects represented only by still images. Font substitution/render warnings are separate. Matching deck/PDF pairs are grouped by source stem; this does not assert any slide was shown in a meeting. Native text retains its original script; OpenCC remains scoped to ASR.

Validation passed in Podman:

- 33 standard Bun regressions (195 assertions) on a disposable database, including atomic grouped uploads, exact video/deck selection, immutable history, stale-revision notices and partial acceptance. Three fixture-dependent integration cases skip here and run separately below.
- Three isolated Bun/media integrations (44 assertions), using the real 38-slide deck, 13-page report and a rotated derivative of a real page. Replay publishes once; explicit retry creates an immutable child revision, reuses every image asset ID and preserves notes/EXIF metadata. Exports are complete and memory stays empty.
- Six Python checks: notes/hidden slides/font substitution/static media, scanned PDF OCR/partial coverage, rotated image transforms, bounded native PDF blocks, two-column source coordinates, and unsupported format rejection. Temporary derivatives of real sources are removed from isolated storage.
- Twelve Chromium checks: all eight document viewers reach the last unit and export pinned evidence; selection survives reload and restores the previous draft; all three video viewers still seek/export correctly.
- Cross-language JSON Schemas, Svelte/TypeScript (zero errors/warnings), frozen development/media/release builds, release worker imports, and read-only document/video corpus evaluations.

Saved selections are mutable local drafts with exact upload/revision IDs and partial acceptance. Corrections do not change them; older revisions stay visibly pinned and offer explicit reselection. They are not immutable push batches or memory commits. The memory action remains disabled until M4 implements atomic push and Chronicler processing.

### Adapter comparison

The separate frozen environment pins Docling-slim 2.133.0, Docling-core 2.99.0 and Docling-parse 7.22.2. Native backends matched all 255 units and ten notes. PPTX outputs expose 153 pictures and five native tables in the subcontract deck; these are representation items, not independently corroborating evidence. The comparison took 37.64 seconds and did not benchmark the learned layout/OCR pipeline. Production retains Python-pptx/LibreOffice/Poppler/Pillow/Tesseract for source text and full renders. Structured crops/tables can adopt Docling later behind the staging contract. [Docling model](https://docling-project.github.io/docling/concepts/docling_document/), [PPTX notes API](https://python-pptx.readthedocs.io/en/latest/user/notes.html), [LibreOffice hidden-slide export](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html).

## Document labels, embedded media and plain summaries (2026-10-06)

The requested document hierarchy is implemented: document summary → slide/page label → embedded image/video label → original asset and preview evidence. `documents-3` revisions preserve all 255 numbered renders, 1,005 native blocks, ten notes and one hidden slide. The four PPTX sources contain 145 image resources (67/21/29/28 by deck), including six WDP resources retained byte-exactly with labeled slide-crop previews. They contain no embedded video files. A temporary deck derived from the real September 8 recording verified original clip hashes, slide relationships and four correctly bounded frame previews; its input/temporary assets were removed by the isolated Python runner. Embedded audio and motion between the sampled frames remain uninterpreted.

The maintained read-only corpus evaluation checks all originals against their corpus SHA-256 values and every extracted PPTX resource against the corresponding original package entry and bundled file. All image/render/media links and portable exports pass; memory remains empty. Browser coverage passes across all eight document viewers and three videos, plus pinned selections. Native text remains source text; Qwen descriptions use English, with Traditional Chinese quotations/names and valid evidence references. PDF understanding uses every page image; native/OCR text remains available for inspection. Source-text corrections invalidate descriptions, while description-only revisits preserve corrections and immutable history. Checkpoints are content keyed, and later successful checkpoints remain usable even when earlier uncached requests encounter a serving outage.

Local Podman validation passes 41 standard Bun regressions (239 assertions), three real-document integrations (58 assertions), eight Python checks, 12 Chromium checks, portable JSON Schemas, Svelte/TypeScript with zero errors/warnings, and frozen development/media/release builds. Offline tests explicitly blank hosted credentials so Bun's automatic `.env` loading cannot send regression inputs to the real API. Video corpus source/citation/export checks still pass.

**Full live model acceptance passed on all eight documents.** `pro6000/qwen38-flash-next` completed all 255 page/slide labels, all 145 embedded image labels and eight plain summaries, with source citations and no review omissions. The gateway initially returned intermittent HTTP 500 `Hosted_vllmException — Server disconnected`, including on a tiny text-only request. Once it recovered, description-only revisits reused successful checkpoints and completed the remaining work. The June 29 PDF also exposed a response with 15 citations against the declared maximum of 12; retry now explicitly restates the validated JSON/citation constraints instead of silently truncating evidence. Generated summary prose normalizes escaped paragraph breaks and keeps machine reference codes in structured citations. Viewer controls remain disabled until their event handlers are ready, resolving a fast-loading navigation race. The default `bun run eval:interpreter:documents`, requiring complete model coverage, now passes. The explicit `DOCUMENT_REQUIRE_REVIEW=false` mode can verify source/export integrity during future outages; it does not waive live model acceptance. Private observations and summaries are in ignored `data/evaluations/documents.json`. This validates application behavior and coverage; description accuracy remains human-unreviewed.

These checks establish source mapping and honest coverage, not perfect OCR, reading order or numerical chart interpretation. No human document-fidelity reference has been supplied. Full renders and originals remain inspectable. Private reports, parser outputs and screenshots stay under ignored `data/evaluations/`; raw evidence, credentials and evaluation environments stay out of release images.

## Boilerplate-aware media review (2026-10-06)

`document-review-2-en` retains all original media and preview primitives, but uses a structured `skippedMedia` reason for standalone logos, classification stamps and decoration instead of generating captions. Meaningful or uncertain figures remain described; videos cannot be skipped. Exact decoded-image repeats share a model decision, remapped to each artifact's evidence IDs. Boilerplate stays in a collapsed downloadable source list and portable bundles; summary observations omit its media descriptions. Older revisions without this optional field still validate.

Podman checks passed 44 Bun regressions (258 assertions), three real-document integrations (58 assertions), Svelte/TypeScript with zero errors/warnings, frozen development/release builds, release worker imports and all 12 Chromium checks (including collapsed boilerplate/download links). Read-only corpus evaluation first verified source integrity during the serving outage. After recovery, the default `bun run eval:interpreter:documents` passed full model coverage, raw hashes, extracted package bytes, all media/render/export files and memory isolation across eight documents. The June 29 viewer/navigation/export check also passed against its final revision.

Live Qwen revisits completed on all four decks: subcontract (23 content labels, five boilerplate exclusions), July 20 (20 content labels, one exclusion), August 4 (27 content labels, two exclusions) and June 29 (55 content labels, 12 exclusions). Across 145 preserved resources, 125 have content descriptions and 20 are classified as boilerplate. Visual inspection confirmed the subcontract deck's restricted-access stamp and ITRI logo; originals remain intact. The June 29 deck encountered HTTP 500 serving failures on both the revisit and a tiny text-only probe; a second revisit also deferred all model work. After the user confirmed backend recovery, a text probe succeeded and a description-only revisit completed all 38 slides and 67 media decisions with a plain summary. Earlier incomplete and complete descriptions remain in immutable history. All current document reviews are complete; classification accuracy still requires human judgment. The four PDF revisions were not reprocessed for this media-only change.
