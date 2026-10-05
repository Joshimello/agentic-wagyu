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
4. Read every transcript segment in contiguous blocks; propose specific questions about missing visual context and evidence for speaker names. No evenly spaced transcript sampling or beginning/middle/end frame instructions.
5. Search near the cited speech with `get_contact_sheet`; record questions, reasons, searched times, actual frames, answers, and unresolved cases. Validate structured annotations and tentative names before publication.
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

The adapter attempts continuous windows up to the model card's advertised 90-minute range. A complete single window gives one anonymous-speaker namespace. The 65-minute real meeting stopped at 49:37 in two single-pass attempts despite a 65,536-token output budget; the second ended with EOS at 16,380 generated tokens. A 30-minute pass reached 29:59.98. Do not equate normal EOS with full transcription. A final unrepresented interval longer than 60 seconds is conservatively marked uncertain: it could be silence or an early model stop. A long uncertain/truncated attempt falls back to 30-minute windows, preserving attempts in caches and separating speaker codes across windows. A remaining omission remains visible. There is no automatic cross-window voice match.

```ts
get_contact_sheet({
  timesMs: number[], // 1–4 unique container timestamps, in milliseconds
  reason: string
})
```

Trusted context fixes the source. Each question cites actual transcript IDs. Searches must stay within 90 seconds of that speech, use at most two sheets of four frames, and persist the reason and requested/actual timestamps. Up to six questions per transcript block are proposed; up to 24 are researched, and deferred or unanswered questions remain visible. The complete transcript is still read when the frame budget is reached. An empty question list is valid when there is no missing visual context.

Contact sheets use real presentation timestamps with keyframe seeking. Single-frame sheets preserve more readable detail; multi-frame sheets have larger cells than the initial pilot. All searched frames are retained as source derivatives so the audit and unresolved searches remain inspectable/exportable. This is targeted visual coverage, not an exhaustive account of every frame. Exact decoder timing and audio-offset behavior are checked with temporary transformations of real footage. [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html).

Qwen's structured planning uses `chat_template_kwargs.enable_thinking=false` on the configured gateway: live verification found that enabled reasoning exhausted the output budget before returning JSON. Other model providers receive ordinary Chat Completions parameters. [Qwen serving documentation](https://qwen.readthedocs.io/en/stable/deployment/vllm.html).

Annotations cite speech, searched frames, and the question they answer, with model/prompt provenance. Name suggestions preserve the original speaker code and include a candidate name, model confidence, basis, explanation, and cited voice/text/frame evidence. Self-introductions, handoffs, participant labels, and active-speaker indicators can support tentative names; a static participant tile or a mentioned name does not establish who spoke. Unknown speakers remain unnamed; no face identification or automatic speaker merging occurs. Confidence is uncalibrated and every suggestion stays unverified.

**Revisit visual context** pins the current staging revision and runs no ASR. It preserves text, speaker codes, corrections, and prior immutable revisions. Concurrent corrections stay current; the older-input interpretation is available in history. Text/speaker corrections remove name suggestions relying on changed speech and mark affected context questions unresolved. Markdown/JSON/offline exports include the context-search audit and tentative names; the plain transcript keeps spoken words separate.

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
