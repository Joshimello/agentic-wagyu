# Archived: Interpreter — implementation plan

Superseded on 2026-10-04. This separate-project design is historical; see the active root plan and docs/agents/interpreter.md.

Updated: 2026-09-30. See the [monorepo plan](../../plan.md) for the shared contract and observed hardware.

## 1. Goal

Independently upload, inspect, and export multimodal sources as traceable text and image primitives. First release: meeting recording → diarized transcript → selected visual context. Later adapters cover PDFs, PPTX, images, and text through the same Evidence Bundle contract.

Interpreter owns source fidelity and representation. Research assertions, cross-meeting entity resolution, decisions, and current project state belong to Chronicler.

## 2. Research and component choices

| Component | Finding | Decision |
| --- | --- | --- |
| MOSS-Transcribe-Diarize | Timestamped transcription with anonymous speaker labels; upstream advertises 50+ languages and recordings up to 90 minutes. [Model card](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize) | Preferred initial local ASR adapter. Measure our actual language/duration/memory limits. |
| MOSS runtime | Python inference and OpenAI-compatible transcription serving are documented, with backend-specific configuration. [README](https://github.com/OpenMOSS/MOSS-Transcribe-Diarize) | Start with a pinned local Python setup; normalize outputs behind an adapter. Choose a serving engine only after measuring. |
| FFmpeg/ffprobe | Frame selection, scaling, and tiling are supported. [Filters](https://ffmpeg.org/ffmpeg-filters.html) | Inspect streams, derive audio, decode frames, build contact sheets. |
| Docling | Unified representation includes text, pictures, tables, reading order, layout, and provenance. [Document model](https://docling-project.github.io/docling/concepts/docling_document/) | Evaluate as a document adapter, mapped into our own contract. |
| LibreOffice | Command-line PowerPoint import/PDF export filters are available. [Conversion docs](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html) | Candidate PPTX renderer; verify fonts/layout on fixtures. |

No models or GPU packages have been installed during planning. Pin model weights, custom model code, packages, and rendering versions. The machine's two GPUs make local deployment a reasonable direction, but do not establish runtime compatibility or throughput. Start on one GPU with one ASR job at a time. OpenAI/Luna remains the preferred VLM adapter under the existing user preference.

## 3. Source, representation, and interpretation

Preserve three distinct levels:

1. **Original source:** immutable uploaded bytes.
2. **Source representations:** native text, ASR/OCR, page renders, frames, and crops, linked to locations and producing runs.
3. **Interpretive annotations:** visual descriptions, suggested labels, and transcript-to-frame relevance links, with model provenance and uncertainty.

Never silently rewrite spoken words to insert visual information. Compose the enriched transcript from unchanged utterances plus separate visual notes/links. User transcript edits create a new representation revision with an edit record.

Example display/export organization:

```text
yesterdays-meeting.mp4                 immutable original
  metadata                            uploader, dates, duration, value origins
  extraction revision 1
    bundle.json                       authoritative structured representation
    transcript.json                   ordered, timestamped speaker segments
    transcript.md                     readable rendering
    transcript-with-visual-context.md  same segments + separate visual notes
    frames/frame-000184.png            selected image; actual time in manifest
    frames/frame-000291.png
    contact-sheets/sheet-01.jpg         optional inspection artifact
    coverage.json                     omissions, warnings, inspection coverage
```

Friendly names are not identity; use IDs/hashes internally. Frame asset names need not encode timestamps because the manifest supplies exact source locators. Retain readable individual images, not just small thumbnails. Full-page/slide renders remain available when crops lack context.

Metadata distinguishes uploader from author, participants, and anonymous speakers. Record source/event time with timezone/precision/basis separately from upload/extraction time. Embedded timestamps and filename guesses are candidates. Preserve each value's origin and confirmation state; user confirmation can change display preference without erasing earlier values. Project labels are hints for Chronicler, not resolved project entities.

## 4. Video pipeline

1. Stream the upload to disk, hash it, probe streams/duration/codecs, and create a submission. Identical bytes share storage but preserve submission metadata.
2. Queue a processing run with pinned pipeline/model/config versions and checkpointed stages.
3. Select the audio track, preserve its timeline offset, and derive the audio format required by MOSS. Record channel/resampling transforms; keep the original media. Handle no-audio recordings explicitly.
4. Run MOSS, preserve raw output, and normalize utterances into integer millisecond intervals and run-scoped speaker IDs. Detect malformed segments, truncated output, and missing coverage.
5. Build a sparse initial storyboard from time samples plus scene/slide-change candidates. Provide it with transcript windows so the VLM has an overview before choosing detailed timestamps.
6. Give the VLM one bounded frame-inspection tool. It inspects relevant visual context and proposes structured annotations/links.
7. Validate source membership, segment/frame IDs, temporal links, and labels. Persist selected full-resolution frames/crops and provenance.
8. Assemble/validate the manifest, generate exports, then publish the bundle revision atomically. A failed visual stage can publish a clearly marked transcript-only result, not a visually complete success.

Sampling can miss brief visual events. Record inspection coverage and test the omission risk. A video containing only camera views may correctly produce few relevant frame links; do not force annotations for every utterance.

### Frame inspection tool

```ts
get_contact_sheet({
  timestamps_ms: number[],
  detail?: "overview" | "readable",
  crop?: { x: number; y: number; width: number; height: number }
})
// Returns an image payload plus sheet_id and cells[]:
// primitive_id, requested_ms, actual_ms, source dimensions,
// tile rectangle, crop transform, per-cell warnings.
```

Artifact/run identity comes from trusted execution context, not a model-selected path. The optional crop uses normalized top-left coordinates within image bounds. One timestamp with readable detail returns a larger frame; the same tool can provide a crop for small plot labels.

- Initial tuning limits: 12 cells/sheet, 4 calls/5-minute transcript window, plus a total per-artifact image/token budget. Freeze sensible limits after S0/I3 evaluation.
- Label every cell with frame ID and actual time; return machine-readable mappings so grid order is unambiguous.
- Use actual presentation timestamps, including variable frame rate and audio/video offsets. Do not derive timing solely from nominal FPS.
- Cache by raw hash, stream, actual timestamp, crop, and render configuration. Preserve requested time as well as returned time.
- Contact sheets locate useful evidence. For fine text/numeric claims, request readable detail or mark the region unreadable.
- Persist budget stops, failed requests, and inspected ranges. Save calls and structured outputs for reproducibility without requiring private model reasoning.

### Visual annotation contract

```text
annotation_id
text                          generated visual observation
transcript_segment_ids[]      segments it may contextualize
image_primitive_ids[]         frames/crops actually inspected
relationship                  illustrates | displayed_during | possible_reference
epistemic_status              observed | uncertain
producing_run/model/prompt
```

Annotations are text primitives linked to images and utterances. Temporal co-occurrence alone does not establish that a speaker meant a particular chart. Generated observations remain distinct from transcript quotes and research claims.

### Speaker continuity and long recordings

MOSS labels such as S01 are anonymous and scoped to the input recording, not real identities. Store user-confirmed name mappings separately with provenance. No automatic face identification or cross-recording speaker merge is required. [Model output semantics](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize)

Measure increasing recording lengths and overlapping speech. If chunking is needed, retain source offsets, namespace chunk speaker IDs, deduplicate overlapping text carefully, and flag uncertain continuity. Never assume S01 in two chunks refers to the same person. Validate decoder output coverage instead of blindly adopting a short example's token limit.

## 5. Document/image adapters

| Input | Minimum representation | Required checks |
| --- | --- | --- |
| TXT/Markdown/SRT/VTT | Ordered text blocks or timed utterances; supplied speakers/times | Unicode, exact span mapping, malformed timestamps. |
| PDF | Page renders + native text blocks; images/crops; labeled OCR fallback | Reading order, multi-column layout, mixed scanned pages, page/region mapping. |
| PPTX | Slide renders + native text + separately labeled speaker notes; figures/layout where available | Native/rendered slide mapping, fonts, clipping, hidden slides. Notes are not speech or displayed text. |
| Image | Original + oriented display representation; optional OCR/crops | Rotation transforms, dimensions, illegible text, OCR-to-region mapping. |

Preserve readable images of tables/diagrams even when structure extraction fails. Optional table/layout JSON may accompany primitives. PPTX animations and embedded media remain explicit coverage limitations until supported. Compare a simple native extraction/rendering path against Docling on representative fixtures before selecting the document backend; avoid maintaining redundant parsers without evidence they help.

## 6. Storage, APIs, and reliability

Interpreter owns `assets`, `submissions`, `metadata_values`, `processing_runs`, `bundle_revisions`, `primitives`, `primitive_links`, and `corrections`. Payloads live on disk; records store hashes/MIME/locators. Published source representations are immutable; job status can change.

Minimum operations: upload, inspect status, list published revisions, get manifest, resolve evidence asset, add correction, reprocess, and export. Source/asset access resolves IDs rather than arbitrary paths. Write assets durably before atomic publication. Queue insertion shares the metadata transaction or uses an outbox; orphaned staging files are cleaned up without removing published evidence.

Checkpoint ASR, frame extraction, VLM annotations, and exports separately. Retries reuse completed work. Configure byte/duration/disk/token limits independently; the original plan's universal 25 MiB limit is unsuitable for video. Preserve API usage, GPU job timing, and disk usage separately. Apply subprocess timeouts and resource limits to media/document parsers.

## 7. Testable milestones

### I1 — Standalone shell and evidence bundles

**Depends on:** S0.

**Deliver:** upload/review shell; raw/submission storage; metadata provenance; durable worker; text adapter; bundle validation/export.

**Test:** `pnpm --filter interpreter test:milestone I1`: same bytes with different metadata, invalid paths/hashes, crash/retry, text export/reimport.

**Pass:** one stored blob can retain distinct submissions; metadata origins remain visible; bad bundles cannot publish; retry creates one revision. UI works with Chronicler stopped.

### I2 — Local MOSS transcription

**Depends on:** I1 and S0 runtime measurements.

**Deliver:** MOSS adapter, source timeline mapping, timestamped speaker segments, transcript viewer/export, coverage/error reporting.

**Test:** `pnpm --filter interpreter eval:transcription`: representative held-out labeled excerpts; silence/overlap/no-audio/truncation cases; GPU failure; actual target recording duration. Evaluate CER/WER appropriate to the language and speaker-attributed error.

**Pass:** all segments have valid source intervals and scoped speakers; partial output is flagged; meet corpus-specific error thresholds frozen during S0. Proposed alignment target: 95% of reviewed segment boundaries within 1 second. Report runtime versions, peak VRAM, real-time factor, and coverage. A short smoke test alone does not establish full-meeting readiness.

### I3 — Visual context and linked frames

**Depends on:** I2.

**Deliver:** initial storyboard, contact-sheet tool, readable frame/crop requests, annotation validation, referenced frame assets, enriched transcript.

**Test:** `pnpm --filter interpreter test:milestone I3` checks a synthetic video with visible frame times/slide changes, variable FPS, audio offset, repeated slides, bad timestamps, illegible charts, and budget stops. `eval:visual-links` uses at least 20 labeled references including negative examples.

**Pass:** every link resolves; decoded frame timing matches the synthetic source within one frame; the enriched transcript preserves every original utterance verbatim. Proposed pilot targets: 90% correct links, 80% recovery of relevant labeled visuals, and no unsupported numeric chart claims in critical fixtures. Keep ASR alignment error separate from decoder timing error.

### I4 — Standalone video release

**Depends on:** I3.

**Deliver:** upload → progress → synchronized transcript/frame review → correction → export; local startup; full/compact exports; backup/restore.

**Test:** `pnpm --filter interpreter test:e2e`: one representative meeting end to end, crashes during ASR/enrichment/export, earlier revision reopening, full export with server stopped, restore into fresh storage.

**Pass:** complete flow needs no SQL; corrections preserve prior representations; full export is self-contained; compact exports declare missing raw media. A failed enrichment stage leaves a usable, accurately labeled transcript-only bundle.

### I5 — PDF, PPTX, and images

**Depends on:** I1 contract; release after I4 unless priorities change.

**Deliver:** the remaining adapters, page/slide/region locators, rendered images, labeled OCR/native text/notes, and visible coverage.

**Test:** `pnpm --filter interpreter eval:documents`: multi-column PDF, scan, chart, slide notes/hidden slides, missing font, rotated image, and mixed-language text.

**Pass:** supported pages/slides have source-linked renders; every critical expected item is represented or explicitly flagged as unsupported; notes are not treated as speech. Gold review confirms reading order and crop/slide mappings. Preserving a diagram image is not a claim that its meaning was extracted correctly.

I4 is the independently useful video product; I5 completes the initial multimodal input scope. Language/duration-specific quality claims require representative evaluation, even with substantial local GPU memory.
