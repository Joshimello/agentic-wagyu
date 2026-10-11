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

## Explicit push and weekly research memory (M4–M5, 2026-10-06)

**Functional acceptance passed.** Staging now supports explicit push of exact revisions, with recorded partial-coverage acceptance and an immutable batch. A separate durable Chronicler queue extracts seven typed assertion schemas, matches project scope, resolves named entities within that project, and reconciles against committed memory. It publishes identities, assertion versions, relations, evidence admissions, events and per-file outcomes in one guarded transaction. Model failure or invalid provenance leaves existing memory unchanged. Push retry and unchanged replay retain the original selection. Source edits alone cannot alter memory.

The UI exposes push progress/retry/outcomes, incorporation badges, project cards, a graph of projects/assertions/conflicts, recorded/effective history, typed arguments and exact admitted sources. The bounded graph distributes recent assertions across projects; the full assertion list remains available. Citations open pinned text or images with original locators and raw-asset links. Historical snapshots remain accessible after later pushes.

### Real weekly sequence

Using `pro6000/qwen38-flash-next`, the maintained operator evaluation pushed the supplied three decks and then the three meeting recordings individually. Corpus families specify expected research themes for evaluation, not forced project IDs. Project resolution used actual text/images and the committed catalog. Each series shares a project across **all three** weeks. All VLM decks matched Prompt-to-Path Planning. Meetings shared 3D Gaussian Splatting Reconstruction and Repair and Depth Estimation Model Evaluation, while also identifying GS Evaluation Protocol Development, Multi-Pose Object Reconstruction and Merging, and Uncertainty-Guided View Sampling Pipeline. Their finer grouping remains a model interpretation requiring human review; the user can override project scope before a push.

| Source | Memory version | Cumulative projects | Cumulative statements | Accepted assertion versions in push | Enqueue to commit |
| --- | --- | --- | --- | --- | --- |
| 260629_VLM.pptx | 1 | 1 | 45 | 45 | 133.46 s |
| 260720_VLM.pptx | 2 | 1 | 79 | 39 | 110.25 s |
| 260804_VLM.pptx | 3 | 1 | 111 | 43 | 121.74 s |
| 2026-09-08.mp4 | 4 | 4 | 148 | 37 | 108.11 s |
| 2026-09-15.mp4 | 5 | 6 | 220 | 74 | 311.35 s |
| 2026-09-22.mp4 | 6 | 6 | 292 | 74 | 439.76 s |

Durations include queue waiting, retries and operational interruptions, using durable batch timestamps. They measure Chronicler on already extracted evidence, **not MOSS transcription or document extraction**. September 15 required two worker attempts; September 22 required four. The final successful September 22 attempt took about 167 seconds, while the full batch lifetime was about 440 seconds. Excess evidence-reference arrays caused schema failures. `chronicler-3-en` now explicitly requires a few strongest citations (1–12 for each project/entity/assertion) and sends the invalid JSON plus exact schema issues to its repair request. Validation limits were retained. Failed attempts did not publish partial memory. Earlier successful outputs retain their original prompt version/checkpoints.

June 29's existing partial extraction was explicitly included; its source animations/format warnings remain visible. Other selected revisions reported complete extraction. The recordings' source dates are still unknown: filename dates determined test order but were not accepted as effective-time evidence. All accepted real assertion dates remain unknown, so the live evaluation establishes recorded weekly accumulation, not verified calendar-time supersession. Dated offline cases establish effective/known-time behavior in both arrival orders.

Replaying all six exact inputs returns their original batch IDs and leaves memory at version 6. The four PDFs remain never pushed and contribute no assertion evidence. Final memory contains **292 statements, 312 immutable versions, 20 support relations and one conflict**, with both conflicting claims retained. Read-only integrity evaluation resolves all **769 unique historical citations**, checks exact quotations and project-scoped relations, and observes unchanged pinned snapshots during evaluation. Supersession is exercised in dated regressions; no real assertion was superseded based on an unconfirmed date.

### Durable verification and limits

Podman checks passed:

- 54 standard Bun regressions (295 assertions); 15 integration cases skip here and use separate runners.
- 12 isolated PostgreSQL memory regressions (66 assertions): mixed-file all-or-nothing publication, pinned inputs/double-clicks, edits during processing, unpushed controls, failure/retry, interrupted transaction rollback, no-assertion admissions, stale concurrent refresh, A/B updates in both arrival orders, conflicts, corrected sources, prior citations, SDK schema repair/checkpoint replay, three-week state evolution and durable outbox replay. Disposable databases/storage are removed and hosted credentials are blanked. A lasting domain regression also prevents anonymous/role speaker labels from matching across source revisions; the accepted real person entities each have support from only one recording/document.
- 14 Chromium checks across documents, recordings, selections, graph/history and source inspection; memory checks also pass on the final version-6 snapshot.
- Svelte/TypeScript with zero errors/warnings, frozen Bun development/release builds, release worker imports and exclusion of credentials, evaluation tools, tests and raw data.
- Read-only document and recording corpus evaluations after publication: hashes, source mappings and portable exports remain valid, and memory stays at six commits before/after each evaluation.

These establish lifecycle, provenance, isolation and history invariants. **Extraction precision/recall, semantic citation support, ownership and project-classification accuracy have not been human scored**; proposed 90%/80% targets are not claimed as met. Model confidence is uncalibrated. Unknown dates, tentative speaker/name attribution and uncertain technical terminology remain disclosed. Projects/entities have immutable scoped identities; global identity merging/remapping and derived lexical/vector Researcher retrieval are deferred. Researcher answers are not implemented in these milestones. Reports and model-generated evidence stay under ignored storage/database, outside Git and release images; originals and earlier revisions are preserved.


## Summary-first organization (2026-10-07)

**Functional acceptance passed.** `/memory` now starts with source-linked summaries. A source overview leads to contiguous discussion/section summaries, then exact ASR/native text, page/slide renders and linked frames. A continuing project leads to topic summaries across weeks and the same shared segment identities. Summary previews keep the root outline scannable; node pages contain full summaries, original evidence and recorded history. Search includes both summary prose and underlying admitted text. The earlier assertion graph remains at `/memory/assertions`.

Migration `0004_organization.sql` adds immutable node identities and versions. Source/segment versions pin their staging revision and version-1 source-unit ranges. Project/topic versions pin exact child-summary versions. Publication checks complete ordered coverage, scopes, active admissions, immutable source organization and history in the same memory transaction. Corrections withdraw replaced leaves only after push and rebuild affected overviews; prior snapshots still resolve their original children and evidence. Retry checkpoints pin model/prompt/payload/image hashes, stale work rebuilds, and unchanged inputs have one effect. No MOSS or document extraction was rerun.

### Real source organization

The live Qwen sequence produced **two broad projects, 14 topic scopes and 120 segments** at snapshot **13**. All three VLM decks share Prompt-to-Path Planning; all three recordings share 3D Reconstruction and Gaussian Splatting. The projects remain distinct. UAV topics include task formulation, related work, experiments, prompt comparison, failure analysis and agentic direction. Reconstruction topics include model evaluation, benchmark/data-format coordination, depth evaluation, view sampling, TTT/KV cache and pose merging. A low-confidence sampling-topic match retained a separate scope with the same descriptive title; these inferred groupings still need human judgment. Unknown official project names do not imply that a clear research objective cannot receive a descriptive organizing label.

| Source | Segments | Result snapshot | Queue to commit for accepted pass |
| --- | --- | --- | --- |
| 260629_VLM.pptx | 16 | 7 | 130.63 s |
| 260720_VLM.pptx | 16 | 8 | 144.89 s |
| 260804_VLM.pptx | 15 | 9 | 152.12 s |
| 2026-09-08.mp4 | 17 | 10, then scoped at 11 | 59.65 s segmentation + 71.00 s scoping |
| 2026-09-15.mp4 | 34 | 12 | 241.86 s |
| 2026-09-22.mp4 | 22 | 13 | 223.89 s |

These durations cover Chronicler on existing staging, not raw media processing or development/review time. September 8's first pass left every project null because no official name/catalog match was available. `organization-2-en` explicitly allows descriptive new projects and an explicit `organizationMode: "scope"` pass reads unassigned segments and source text, adding only project/topic versions. Its source overview, 17 segments and original evidence remain unchanged. One exploratory September 15 batch was canceled before publication during this correction; its checkpoint/progress history is retained and its runtime is excluded from the accepted-pass table. The replacement batch used the pinned original revision. Cancellation now stops later model requests and cannot become a failed or accepted push accidentally.

### Integrity and limits

The maintained real-source evaluation passed complete ordered range coverage and an independent exact-text comparison: **104,741 original characters** are reachable, without omission/reordering, through segment drilldowns. It resolves all historical child-version pins, checks project continuity/separation, preserves the four unpushed PDF controls and proves replay leaves snapshot 13 unchanged. A second complete evaluation returned the same batch IDs and results. Existing typed memory remains **292 statements, 312 versions, 20 support relations and one conflict**; all **769 unique historical citations** still resolve. New project identities share the catalog table, so the typed API's overall project catalog includes the two new organizing scopes as well.

Podman checks passed 58 standard Bun regressions (313 assertions), 12 legacy memory integrations (66 assertions), seven organization integrations (53 assertions), all 16 Chromium checks, zero Svelte/TypeScript errors/warnings, frozen Bun development/release builds and release worker imports/exclusion checks. Organization cases cover SDK schema/coverage repair, checkpoint reuse, atomic rollback during node insertion, snapshot isolation, corrected sources, exact-text search, stale work, scope-only enrichment, cancellation and conservative low-confidence matching. Browser checks verify both hierarchy paths reach the same segment, source text/images, snapshot pins, raw-text search and the complete existing staging workflow. Disposable checks never write to the real corpus.

Generated summaries, boundaries and topic assignments have not been human scored. They are navigation interpretations, not independent evidence or confirmation of official project ownership. Source event dates remain unconfirmed in metadata; earlier model prose can contain unverified time/identity/terminology interpretations and must be checked against originals. Technical disagreements, ASR/visual coverage limits and partial document warnings remain visible. Researcher answer generation is not implemented here; the read-only organization/search/node endpoints supply progressive retrieval for the next step. Private outputs/screenshots remain under ignored `data/evaluations/`, outside Git and release images.

## Researcher and cited answers (M6, 2026-10-11)

Researcher is implemented at `/ask` with independent saved questions, project/recorded-snapshot/event-date scope, durable progress, cancel/retry, source-backed answer blocks and exact citation navigation. It starts from source/project/topic overviews, searches full original text as well as summaries, follows pinned children, reads original transcript/slide/page text and inspects actual admitted images. Generated overviews guide navigation and cannot serve as independent citation evidence. The application validates inspected citation IDs and stores the frozen snapshot, original revision/primitive references, text ranges, historical flags, tool trace, model/prompt provenance and usage. Answers can acknowledge insufficient evidence or disclose partial coverage.

Migrations `0005_brown_ender_wiggin.sql` and `0006_blue_bulldozer.sql` add operational research runs/outbox records and a separate delivery generation. These do not rewrite memory. A dedicated query queue consumer remains responsive while an ingestion lane is blocked. Session locks serialize duplicate deliveries and release on worker death; attempt-conditional writes prevent canceled/replaced attempts from publishing. Manual retry preserves the original snapshot and receives a new delivery ID, including cancellation before the first worker claim. Failed runs retain bounded diagnostic traces/provenance. Credentials remain worker-only.

### Evidence reads and retrieval

`researcher-5-en` uses short run-local labels (`E1`, `E2`, …) for model references, mapped to full immutable source IDs in saved citations. The original UUID-facing interface caused live citation mistakes on meeting questions and correctly withheld those answers. Bounded repair now includes the inventory of inspected evidence. Listing an image never makes it citeable; the actual image must be inspected.

Consecutive ASR turns form readable spans of roughly 2,400 characters / at most 60 utterances. Every original text offset, speaker label and timestamp is retained; the source viewer reconstructs the exact span from the pinned revision. Document chunks keep their own primitive ranges. This replaces five-utterance reads, which repeatedly reached navigation budgets before a whole meeting discussion was read. A live cross-week TTT/KV-cache question completes through the real queue in about 35 seconds with source spans from both recordings and an explicit partial-coverage status. The earlier narrower answers remain saved rather than silently rewritten. Snapshot 13 and accepted evidence are unchanged; no media interpretation or Chronicler ingestion was rerun. The first complete repeated suite withheld one invented citation and exposed three discovery-only cross-project answers. The current workflow pauses discovery after two calls once segment candidates exist and requires an original-text read before more searching, with a durable SDK regression. An absent requested file must be reported as unavailable in the scoped catalog rather than substituted with a similar source. All six affected live retries then pass structural and automated semantic checks. Earlier reports are retained as development evidence, not counted as final acceptance.

The configured gateway returns HTTP 404 for embeddings. This implementation therefore uses multilingual IDF-weighted lexical channels for summary/title/keywords and original text, with reciprocal rank fusion and hierarchy traversal; it does not claim a pgvector semantic index. Chinese queries normalize Simplified/Traditional variants and use Han bigrams. Pagination, text/image/tool/context budgets, missing images and uncertain dates are disclosed. Project-scoped mixed-source overviews/keywords are masked, and only authorized segment children are exposed. Date filters exclude unknown/future source dates and mask aggregate prose that could incorporate later evidence. File-derived dates remain tentative.

Researcher queries the summary-first hierarchy. Legacy typed-only snapshots before organization remain inspectable through `/memory/assertions`; a Researcher fallback adapter for those earlier assertion-only snapshots is not included. Historical summary snapshots, earlier node versions, corrected evidence and saved answer citations are supported. This version has independent questions rather than a multi-turn chat evidence store.

### Durable verification

Podman validation passes:

- 73 standard Bun regressions / 382 assertions, including 15 Researcher unit/SDK cases for original-text discovery, multilingual tokens, project/date scope, masked mixed-source prose, evidence budgets, exact transcript span reconstruction, invalid references, image inspection and limited answers at the context threshold. Integration suites run separately.
- Seven isolated PostgreSQL/queue/SDK Researcher cases / 40 assertions: idempotent question creation, snapshot capture, citation repair, a push completing during the query, unpushed files/new revisions, provider failure/retry, cancellation, duplicate delivery, worker redelivery, corrected-source history, unchanged memory and independent query capacity during blocked ingestion. Cancellation-before-claim retry exercises real pg-boss delivery generations. Databases/storage are disposable and hosted credentials are blanked.
- The existing 12 memory integrations / 66 assertions and seven organization integrations / 53 assertions still pass. Their memory/citation/history expectations remain intact.
- All 18 Chromium checks pass across staging, document/video inspection, selections, summary/assertion memory, Ask submission/polling, saved answers, exact transcript excerpts and source images.
- Svelte/TypeScript: zero errors/warnings; frozen Bun development/release builds pass. Release worker imports succeed and tests/evaluation tools/reports/data/credentials are excluded. A separate release web container with read-only assets passes health, Ask, both saved-answer pages and all 19 citation URLs for the weekly/project comparisons (23 HTTP checks); it is removed after the smoke test.

The maintained evaluation uses 43 questions over the six admitted sources, three generation runs, two historical snapshots, absent-answer cases, an unpushed PDF decoy, cross-project/cross-week questions and visual checks. One visual-only check asks about the start/destination marker shapes on the actual task-definition slide: the manually inspected render shows a concentric-circle start and star destination, which native slide text does not describe. Ten comparison questions span the August deck and September 22 recording; the same model also answers them through a fragment-only baseline. These sources were used in ingestion development, and the cross-week case helped diagnose read granularity; this is not an untouched statistical holdout. A new independent corpus remains part of the later pilot.

The runner records the model, prompt version, implementation hash, question, fixed snapshot, citations, bounded trace, latency and token usage in ignored `data/evaluations/researcher/`. An automated same-model judge checks answer completeness and each claim's cited original excerpts/images. JSON repair changes only malformed judge output, not the original answer. Every cited image is supplied to the current judge; earlier judgments that omitted images can be repaired with their previous result retained. Structural validity is separate from semantic support. Human scoring of answer correctness, evidence recall and factual support remains pending; model-judge scores are development proxies, not formal human acceptance.

A manual spot check of one broad comparison draft found a statement about generated project labels paired with original-text citations rather than evidence of the catalog labels themselves; the automated judge accepted it. The source-level research distinction was supported, but that attribution illustrates a limitation of the same-model support score. Human review must assess individual claim/excerpt alignment, coverage and inference labels before treating these scores as semantic acceptance.

### Final comparative result

Using the same `researcher-5-en` implementation and Qwen model, the ten comparative questions produce 30/30 valid cited answers over three summary-led runs, with 100% automated correctness/support proxies, 90% initial source-group coverage@10 and 100% final evidence coverage. The fragment-only baseline produces 10/10 valid cited answers in one run, with the same 100% automated proxies, 65% initial source-group coverage@10 and 100% final evidence coverage. Thus the measured advantage is initial discovery coverage; these results do not establish superior answer quality. Median agent latency is 43.662 seconds for the 30 summary-led answers and 47.312 seconds for the ten fragment-only answers. They share the gateway with parallel evaluation requests, so these timings are observations rather than a controlled latency comparison.

### Final full-corpus result

The final `researcher-5-en` suite completes **43 questions × three runs = 129/129 answers**, with **957 structurally valid citations**, no failed generations, no critical failures across 21 critical runs, and unchanged accepted memory at snapshot 13. Responses include 79 answered, 35 partial and 15 insufficient-evidence results; a partial status discloses bounded inspection rather than claiming exhaustive review.

| Measure | Final development result |
| --- | --- |
| Valid in-scope citations | 100% |
| Automated answer-correctness proxy | 129/129 |
| Automated claim-support proxy | 603/604 (99.83%) |
| Initial source-group coverage@10 | 93.42% |
| Final source-group evidence coverage | 96.93% |
| Agent latency | median 36.033 s; maximum 87.155 s |
| Agent token usage | 18,457,717 input; 176,898 output |

Each of the three runs completes all 43 cases. Automated answer-correctness proxies are 100% in each; claim-support proxies are 99.5%, 100% and 100%; median agent times are 36.866, 34.372 and 37.825 seconds. Token/latency figures cover answer generation and tool-loop requests, excluding judge calls; concurrent runs share the gateway. No price or latency SLA is inferred.

The unsupported automated claim occurs in an experimental-environments answer: the three named environments are correctly grounded in the actual slide, but an additional claim about prompt categories and quantitative metrics is not supported by its cited excerpts. This and the manual attribution issue above remain quality-review findings, despite passing structural validity. Source-group relevance checks are developer-authored, deliberately limited proxies rather than exhaustive human evidence-recall annotations; a broad comparison can read useful passages outside those selected gold segments. Formal human correctness/support/recall acceptance remains pending.

Final private reports are under `data/evaluations/researcher/final-v5/`, pinned to implementation hash `dc2fb4abae99092e86817b55dff536ef2aab376eec69ad1494027382c1903976`. `/ask/55a703c5-917a-4b86-9472-cc7351d7cce6` is a saved live project comparison through the real queue (45.276 s); `/ask/1e2d9c44-03c4-4b52-a07d-339ff6cc48e1` retains the earlier cited cross-week TTT/KV-cache answer and its original prompt provenance. Neither is silently regenerated when later code changes.

## Remote integration before the lifecycle pilot (2026-10-11)

Merged remote `939fece` and its four commits into the local Researcher history. The incoming changes add configurable NVIDIA CDI selection, slow-download tolerance for media builds, a separate revision-pinned transcript-translation worker and a redesigned evidence-review workspace. The shared navigation retains Ask with its own active state alongside Staging and Memory.

Both branches independently shipped migration 0005. The merge preserves the applied local Researcher migrations and adds `0007_branch_convergence.sql` with the combined schema snapshot. This forward migration also fills Researcher tables when upgrading from the later translation-only history, without recreating existing records or editing migration-ledger entries. The original remote translation SQL is retained as a maintained upgrade-test fixture. Three disposable PostgreSQL cases verify local-history upgrade, remote-history upgrade, fresh installation and repeated migration application; existing answers, translations, evidence and memory rows survive. Drizzle reports no remaining schema drift.

A private database backup was created before applying the upgrade. Before/after content hashes match for assets, staging revisions, memory commits, node versions and saved research runs; accepted memory remains at snapshot 13. Web, Interpreter/Chronicler/Researcher worker and the separate translator run with the merged Bun image. Existing media and data/cache volumes are preserved.

The first browser pass exposed duplicate document text IDs shared by the incoming full-text dialog and document viewer. The dialog now uses separate IDs for document reading copies while preserving canonical source anchors and video transcript navigation. All eight real document checks then pass, alongside transcript search/loading, translations, late-response isolation, corrections, pinned revisions, memory and Ask.

Final Podman checks: 86 standard regressions / 419 assertions; 12 memory integrations / 66 assertions; seven organization integrations / 53 assertions; seven Researcher integrations / 40 assertions; six translation integrations / 25 assertions; three migration integrations / 25 assertions; all 25 Chromium checks. Svelte/TypeScript reports zero errors/warnings. Frozen dependency development/release builds pass; release worker imports and development-content exclusions pass. A temporary release container passes 26 HTTP checks across health, Ask, both saved comparison answers, their 19 citations, video/document staging and the translation-status endpoint, and is removed afterward. No Researcher prompt or accepted source was reprocessed for this merge; the earlier live corpus evaluation remains a separate quality record.

## Full lifecycle pilot and recovery (2026-10-11)

**M7 implementation and functional/recovery acceptance passed; independent human semantic acceptance remains pending.** The [detailed lifecycle report](lifecycle-pilot.md) records the corpus, timings, token accounting, original retrieval miss and follow-up limitations. [Operations](../operations.md) documents startup checks, budgets, cancellation, recovery, consistent backup and fresh-volume restore.

Interpreter and Chronicler now use session leases, attempt-guarded publication, abandoned-work reconciliation and cancellation that preserves raw evidence and pinned selections. Queued retries receive fresh deliveries. Production model HTTP attempts are metered with concurrent preflight reservations, conservative unknown-outcome accounting and optional configured prices. The Operations page exposes usage and limits without request contents or secrets.

The isolated live workflow passed 114 checks in 715.909 seconds using a real five-minute meeting excerpt, the full July deck, the subcontract deck and the midterm PDF. It covered staging, push, cited answers, correction, repush, history, idempotency and a deliberate worker interruption. Final pilot snapshot 3 contains two projects, 19 topics and 43 segments across four current sources. Main accepted snapshot 13 was preserved. A staging edit on a restored copy of the full main workspace left the hashes of all ten accepted memory tables unchanged.

Main and pilot backups restored into fresh Podman volumes with all 1,130 and 193 assets verified, respectively. The main restore resolved 769 legacy citations, 163 node versions and 13 saved answers/53 citations; the pilot resolved 86 node versions and two saved answers/27 citations. Inspection-only mutation rejection passed on both. Resuming the main restore produced another cited answer without changing memory or rewriting saved answers.

The original ten-question, three-repetition source-holdout run completed 30/30 answers with structurally valid citations and all same-model correctness/support proxies passing. Initial source-group coverage was 87.5%, below the proposed 90% target. A general exact-filename priority fix within accepted scope reached 100% in the follow-up, also 30/30 completed answers with valid citations and passing automated proxies. These were the same exposed questions, so the follow-up is a regression rather than a new blind holdout. Median agent times were 32.524 and 39.003 seconds under shared load. Human correctness, support and evidence-recall thresholds remain unscored. Five additional M6 regression questions passed on main snapshot 13 with unchanged memory.

The pilot production ledger contains 150 HTTP attempts, 149 measured and one interrupted/unknown. Measured usage is 1,040,821 input and 81,869 output tokens; retained unknown reservations yield charged totals of 1,068,564 input and 91,869 output. Standalone evaluation answer-token totals are reported separately and exclude judge requests. API prices were absent, so monetary cost is unknown; electricity was not measured. Pinned MOSS inference for the five-minute excerpt took 13.209 seconds and reported 2.330 GiB framework peak allocation, without truncation. No new independent transcription/diarization accuracy ground truth was supplied.

Final Podman checks pass: 89 standard tests/434 assertions, six operation tests/33 assertions, all memory/organization/research/translation/migration integration suites and 25 browser cases. Svelte check has zero errors/warnings; frozen dependency development/release builds pass. Prompt provenance advances to `organization-3-en` and `researcher-6-en`; earlier saved revisions and answers retain their original versions. M8 cleanup remains a separate milestone.
