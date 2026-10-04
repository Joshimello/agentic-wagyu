# Interpreter worker

Updated: 2026-10-05. Part of the [SvelteKit application plan](../../plan.md). Milestones: M0–M3, recovery in M7, and cleanup in M8.

## Responsibility and boundary

Automatically process uploaded files into reviewable staging revisions. Own source representation and visual enrichment; leave research assertions and memory changes to Chronicler. The worker is implemented under `apps/web/src/lib/server/agents/interpreter`; all persistence goes through shared application services/Drizzle. Python media inference is a subordinate runtime.

Input: upload ID, immutable asset identity, interpretation configuration, and requested processing version. Output: a validated staging revision with primitives, metadata, relationships, coverage, and provenance. There is no automatic Chronicler dispatch on completion.

Run the TypeScript worker with Bun in its Podman container. Keep MOSS, Python, FFmpeg, renderers, and GPU dependencies in the media container, with selected-GPU CDI access and persistent caches. Execute relevant checks in containers and commit coherent implementation increments. M8 removes temporary extraction demos/harnesses and generated reports while retaining source-fidelity/timing regression coverage and required provenance.

Use the environment-configured OpenAI-compatible endpoint and `pro6000/qwen38-flash-next` for development visual interpretation. The basic image-input check passed; contact-sheet readability and diagram accuracy still need the representative evaluations below.

## Pipeline

1. Resolve the scoped asset, probe streams/format, and checkpoint the run.
2. Extract native text or source representations: MOSS transcript, page/slide renders, frames, figures, OCR, speaker notes.
3. Normalize source locators and metadata. Preserve uploader, author, event date, upload date, and anonymous speaker distinctions.
4. Build a sparse storyboard for video; give bounded transcript windows and overview images to the VLM.
5. Let the agent inspect frames through `get_contact_sheet`; validate structured visual annotations and links.
6. Write durable derivatives; validate manifest references/hashes; atomically publish a staging revision through the application service.
7. Notify the UI. A ready revision is reviewable and eligible for push, but has not entered memory.

Deterministic parsing and resource management are ordinary code. Agent reasoning is limited to interpretation/enrichment where it adds value.

## Source representations

Keep originals, source representations, and generated annotations distinct. ASR/OCR are fallible representations; visual captions are generated interpretation. Enriched transcripts compose unchanged utterances with separate notes/frame links. Corrections create new immutable staging revisions.

Two payload primitives suffice: text and image. Roles distinguish native text, ASR, OCR, slide notes, captions, page/slide renders, frames, figures, and crops. Surround them with reading order, grouping, source locators, and optional table/layout structure. Markdown is a generated reading/export view.

Metadata retains origin and confirmation state: user-supplied, embedded, parser-observed, or model-inferred. Do not infer that the uploader spoke, that a filename date is authoritative, or that a supplied project hint has been resolved into a Chronicler entity.

## Video and contact sheets

MOSS remains the preferred local transcription adapter. Its output includes timestamps and anonymous speaker labels; labels are input-scoped and do not identify people. Pin/test the model/runtime on this machine. [Model card](https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize), [runtime documentation](https://github.com/OpenMOSS/MOSS-Transcribe-Diarize).

Preserve selected audio-track offset and resampling transforms. Record raw model output, normalized segments, truncation/malformed-output warnings, and coverage. If long inputs require chunks, namespace speaker IDs and preserve overlap/offsets; never assume S01 is the same person across chunks.

```ts
get_contact_sheet({
  timestamps_ms: number[],
  detail?: "overview" | "readable",
  crop?: { x: number; y: number; width: number; height: number }
})
```

Trusted context fixes the upload/run. The tool returns image data plus cell-to-primitive mappings, requested/actual timestamps, dimensions, and crop transforms. Crop coordinates are normalized and top-left-based. One timestamp in readable mode provides a larger image through the same tool.

- Use real presentation timestamps and preserve variable-FPS/audio-offset behavior.
- Label cells with IDs and actual times; persist selected individual frames/crops, not just thumbnails.
- Initial tuning: at most 12 cells/call and 4 calls per 5-minute window, plus a total artifact budget.
- Request readable detail before interpreting small text/values; otherwise mark unreadable.
- Record inspected coverage and budget stops. Sparse sampling can miss brief events.
- Cache by source hash, stream, timestamp, transform, and render configuration.

FFmpeg supplies frame-selection/scaling/tiling components; exact timing behavior must pass synthetic fixtures. [Filter documentation](https://ffmpeg.org/ffmpeg-filters.html).

Annotation output: generated text, transcript segment IDs, inspected image IDs, relationship (`illustrates`, `displayed_during`, `possible_reference`), uncertainty, and producing run/model/prompt. Co-occurrence alone does not prove the speaker meant a particular figure.

## Document adapters

| Format | Required staged output | Important limitation/check |
| --- | --- | --- |
| TXT/Markdown/SRT/VTT | Ordered text or timed utterances with original span mapping | Preserve supplied names/times and malformed-input warnings. |
| PDF | Page renders, native text, figures/crops, explicitly labeled OCR fallback | Mixed scans, multi-column order, and equations/tables must remain viewable. |
| PPTX | Slide renders, native text, separately labeled notes, hidden-slide flags | Notes are not speech; flag unsupported animations/media and render/font defects. |
| Image | Original and oriented display representation, optional OCR/crops | Preserve rotation/coordinate transforms and unreadable regions. |

Evaluate Docling as a representation adapter and LibreOffice as a PPTX render path using fixtures. Keep their private formats behind the app's staging contract. [Docling document model](https://docling-project.github.io/docling/concepts/docling_document/), [LibreOffice conversion](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html).

## Review, failure, and evaluation

The common SvelteKit staging viewer presents source, transcript/text, visual primitives, metadata, and coverage together. Export is optional convenience, not an internal handoff requirement. Enrichment failure may leave a transcript-only revision with explicit warnings; pushing partial coverage requires a deliberate user choice.

Checkpoints isolate ASR, frames, VLM work, and export. A crash/retry cannot duplicate publication. Source edits/reprocessing never alter an in-flight push's pinned revision. Media byte/duration/disk limits are independent from text/PDF limits.

Freeze corpus-appropriate CER/WER and speaker-error thresholds in M0. Proposed timing target: 95% of reviewed ASR boundaries within 1 second. Validate frame decoding separately against a synthetic timestamped video. Proposed visual-link targets: ≥90% precision and ≥80% relevant-reference recall on at least 20 labeled examples, including negative cases. Numeric chart claims require readable evidence. Record coverage, runtime, VRAM, and cost rather than inferring quality from successful completion.
