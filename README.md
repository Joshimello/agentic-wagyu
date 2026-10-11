# Chronicler

A local SvelteKit application with Bun workers. Uploads become inspectable staging revisions. Explicit pushes publish cited research knowledge into an append-only memory graph. Researcher questions are the next implementation step.

Prerequisites: Bun 1.4.2, rootless Podman, NVIDIA drivers and CDI, and the pinned compose launcher (`uv tool install podman-compose==1.5.0`). The media container uses `NVIDIA_CDI_DEVICE`, defaulting to GPU 0. Services other than the web app stay on the private container network.

Put the configured API credentials in private `.env` (see `.env.example`). Then:

```sh
./infra/dev.sh up -d --build
```

Open http://localhost:5173. PostgreSQL lives in the `chronicler_database` named volume; raw/derived assets and model caches live under ignored `data/`. `./infra/dev.sh down` preserves those records. Do not use `down -v` unless deliberately deleting the database.

Choose or drop source files on Staging to expand the optional upload details. The clear button resets the chooser; Upload stays disabled until files are selected. Review a source, then use **Push To Memory** beside **Original** to publish the displayed revision. Partial extraction requires explicit acceptance. Original recordings and frames open in a same-page preview; click outside or press Escape to close it.

Processing, visual/document revisions, translations and memory pushes report percentage progress from completed work. Progress reaches 100% only after successful publication; percentages measure processing stages, not an estimate of remaining time. **Cancel** targets the displayed operation, stops active requests and local media work, and preserves completed checkpoints and earlier revisions for retry. Selected sources can be removed from Staging, including queued or failed files. Removal cancels related work and clears selections while retaining originals, revisions and accepted memory so historical citations remain readable.

On WSL2, `nvidia-ctk cdi list` normally exposes `nvidia.com/gpu=all` rather than an indexed device. On a single-GPU WSL machine, set `NVIDIA_CDI_DEVICE=nvidia.com/gpu=all` in `.env`. The launcher reads the repository-root `.env` for Compose interpolation. Verify the selected device before starting the stack:

```sh
nvidia-ctk cdi list
podman run --rm --device nvidia.com/gpu=all --security-opt=label=disable docker.io/library/ubuntu:24.04 nvidia-smi -L
```

Use a device name actually listed by CDI. `all` exposes all GPUs available through WSL; indexed selection remains the default on hosts that support it. A successful `nvidia-smi` check establishes container device access; media inference still needs its own smoke test.

The media build downloads large PyTorch/CUDA wheels. Its locked dependency install uses a 600-second HTTP read timeout, five retries, and two concurrent downloads. If a transient download failure interrupts the build, retry the media image and then start the stack:

```sh
bash ./infra/dev.sh build media
bash ./infra/dev.sh up -d
```

The normal rebuild reuses successful image layers. A failed build may leave no application containers to inspect; run `ps` and service logs after startup succeeds.

Run development checks in Podman:

```sh
podman run --rm -v "$PWD:/app" -w /app docker.io/oven/bun:1.4.2 bun run check
podman run --rm -v "$PWD:/app" -w /app docker.io/oven/bun:1.4.2 bun run test:contracts
./infra/test.sh
./infra/test-controls.sh
./infra/test-memory.sh
./infra/test-organization.sh
podman build -t localhost/chronicler-browser:dev -f infra/browser.Containerfile .
podman run --rm --network host -v "$PWD:/app" -v "$PWD/data:/data" localhost/chronicler-browser:dev
```

The regression runner migrates a fresh disposable PostgreSQL database and uses a separate storage directory; it does not write to your workspace database. Browser and live video evaluations inspect the imported real meetings without changing them. GPU/model checks and their corpus limits are documented in `docs/development/acceptance.md` and `docs/development/pilot-scope.md`. Use the existing lockfiles for builds. API secrets are passed only to the worker, never to browser code or built images.

Text/Markdown and meeting video staging work now. Videos use pinned local `OpenMOSS-Team/MOSS-Transcribe-Diarize` inference and the configured Qwen model for visual annotations. New processing uses 30-minute MOSS windows directly, with an explicit output budget and checkpoints. Short recordings use one window; the final window contains the remaining audio. Incomplete or truncated windows remain visibly flagged. Speaker labels are recording-scoped only when one complete window succeeds; matching speakers across windows is unverified. Existing reviewed transcripts remain available unchanged. Qwen reads every transcript segment in contiguous blocks, identifies missing context, and searches nearby frames with recorded reasons. Qwen plans and writes review notes in English. A pinned OpenCC pass converts transcribed Chinese to standard Traditional Chinese (`s2t`), including cached speech and saved corrections; original MOSS output stays in checkpoints/history. Tentative speaker names cite introductions, handoffs, or visible speaker indicators and never overwrite anonymous codes. Use **Revisit visual context** to update these notes without rerunning ASR or losing corrected speech. The operational limits are 512 MiB and four hours, with quality and latency measured separately. Correcting labels/text creates a new revision and preserves the original. Export Markdown, JSON, or a portable ZIP containing both transcripts and referenced frames; the ZIP excludes the original recording.

The supplied meetings are kept in ignored `data/recordings/`. Their hashes, durations, and evaluation context are maintained in `evals/meetings.json`. Import once and inspect the processed corpus with:

```sh
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run import:recordings
podman run --rm -v "$PWD/data:/data" -v "$PWD/services/media:/service/source:ro" localhost/chronicler-media:dev python source/test_media.py
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run eval:interpreter:video
```

The import runner checks hashes and skips already imported files. The read-only live evaluation runs after all three uploads are ready; it writes ignored reports under `data/evaluations/`. The media regressions use temporary transformations of actual recording excerpts and remove their temporary assets. No reference transcript or speaker labels have been supplied, so application checks do not establish transcription or diarization accuracy. Researcher answers are a later milestone.

## Documents and saved selections

PPTX, PDF and single-image staging are available. Select multiple files in one upload to group them with an optional project hint. Grouping is context, not evidence that a deck was discussed in a recording. Select ready sources on the staging list to save exact revisions. Corrections leave the old revision pinned and show a switch-to-current action. Partial extraction needs an explicit include choice before pushing to memory.

Document review starts with a plain Qwen summary. PPTX sources also expose concise slide labels and labels for meaningful extracted images/videos, linked to their source slides. Standalone logos, classification stamps and decoration receive a short exclusion reason instead of descriptions and appear in a collapsed source list; original assets remain downloadable and exported. Identical decoded images share a model decision. Substantive or uncertain figures and all videos retain descriptions. Every slide or PDF page is reviewed visually in small batches; PDFs use the page images for understanding. Generated English descriptions have evidence references and model/prompt provenance and remain staging observations. Chinese quotations/names use Traditional Chinese. Source text keeps its original script. Unsupported image formats retain original bytes with explicitly labeled slide crops when available. Embedded videos retain original bytes and use four preview frames for labels; their audio and intervening motion are not interpreted. ZIP exports include the summary, source-mapped document, page/slide/preview images and extracted embedded originals. Text corrections clear outdated descriptions; **Revisit document descriptions** preserves corrected evidence and makes a new revision using resumable model checkpoints.

PPTX extraction keeps slide text and speaker notes separate, includes hidden slides without renumbering, and pairs each slide with a LibreOffice render. Static-only animations/media and explicit font substitutions are visible warnings. PDF extraction keeps native layout blocks with page coordinates and full page renders; pages without native text use labeled, uncertain Tesseract OCR. Images preserve original bytes, apply EXIF orientation to their display image, and record the transform and uncertain OCR. Native document text keeps its source script; OpenCC applies to speech transcription. Text inside files is source evidence, never application instructions.

Inspect extracted text beside its render using the page/slide navigator. Document ZIPs contain `staging.json`, `document.md`, `extracted-text.md`, and all renders under `images/`; they exclude originals. Whole page/slide images preserve figures, charts and tables for a VLM; independently structured tables/crops are deferred.

The eight supplied documents are in ignored `data/documents/`. Their hashes, expected units and notes are in `evals/documents.json`. Import and evaluate them inside Podman:

```sh
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run import:documents
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run eval:interpreter:documents
podman run --rm -v "$PWD/data:/data" -v "$PWD/services/media:/source:ro" localhost/chronicler-media:dev python /source/test_documents.py
./infra/test-documents.sh
```

The isolated document runner uses a disposable database, storage directory and CPU media sidecar. It checks real PDF/PPTX/image ingestion, retry caching, immutable history, portable exports and memory isolation. Python edge checks use temporary derivatives of actual sources for hidden slides, notes, missing fonts, static media, two columns, scans and EXIF orientation. Browser checks inspect all eight sources and restore selection changes.

A separate frozen environment compares Docling native backends, keeping Docling out of the production media/model environment:

```sh
podman run --rm -e UV_PROJECT_ENVIRONMENT=/tmp/docling -e UV_CACHE_DIR=/data/cache/docling-evaluation -v "$PWD/data:/data" -v "$PWD/evals:/evals:ro" localhost/chronicler-media:dev uv run --project /evals/documents --frozen python /evals/docling-documents.py
```

Results and the adapter decision are recorded in [acceptance evidence](docs/development/acceptance.md). Private parser outputs and screenshots stay in `data/evaluations/`, outside Git and release images.

## Reviewing transcripts

The review workspace pairs original evidence with a short transcript preview. **Show full transcript** opens a searchable reader where you can correct original text and speaker labels. **Original / EN / 繁中** switches between source speech and revision-pinned translations. Translations are separate reading copies: they do not replace evidence or enter memory. Corrections create a new revision with its own translations; earlier revisions and translations remain available.

The `translator` service uses the configured Qwen API independently of local MOSS processing. Translation progress and checkpoints are stored in PostgreSQL, and repeated requests reuse completed results. First-time translation runs when you choose a language. Visual notes share frame galleries, with every captured timestamp and original model observation available in the review details.

## Pushes and research memory

Select exact revisions on Staging, choose automatic project matching or an explicit existing/new project, then click **Push selected files to memory**. The push page shows progress, per-file outcomes and warnings. Retry a failed batch with its original inputs; editing staging does not change an in-flight push or accepted memory. Repeating an incorporated revision has no duplicate knowledge effect.

Open `/memory` for the summary-first view. Sources lead to meaningful discussion/section summaries, then exact transcript ranges, native slide/page text, renders and linked frames. Projects lead to continuing topics across weeks, then the same shared segments. Every passage is retained, including context without a project assignment; a speaker or processing-window change alone is not a semantic boundary. Project matching remains conservative, and independent efforts stay separate. Source dates remain unknown unless confirmed.

Search reads both summaries and underlying admitted text, so details omitted from a summary can still be found. Open a result to fetch deeper evidence only when needed. Recorded-version filters preserve earlier views, and every overview pins exact child-summary versions. Corrected evidence enters current memory only after another explicit push. An explicit scope pass (`organizationMode: "scope"`) can group existing unassigned discussions while preserving their source summaries, segment boundaries and evidence. Historical summaries and citations remain available. The earlier typed assertion graph is preserved at `/memory/assertions`; its `/api/memory` API remains available for comparison. New pushes use the summary workflow; legacy evaluation explicitly selects `workflow: "assertions"`.

Read-only tool endpoints for downstream work are `GET /api/memory/organized`, `GET /api/memory/organized/search?q=...&projectId=...&knownVersion=...`, and `GET /api/memory/nodes/:id?knownVersion=...&versionId=...`. Search and node reads cannot access unpushed evidence. Summaries retain model/prompt provenance and uncertainty notes; source evidence remains authoritative. This supplies progressive retrieval, while Researcher answer generation remains a later step.

The maintained weekly evaluation **writes real memory** by pushing the three supplied VLM decks and then the three recordings in sequence. It records partial-coverage acceptance, checks project continuity/separation and keeps the PDFs unpushed as controls. Run deliberately after reviewing those staged sources:

```sh
podman run --rm --network chronicler_default -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run eval:chronicler:weekly
podman run --rm --network chronicler_default -v "$PWD:/app" -w /app docker.io/oven/bun:1.4.2 bun run eval:memory:integrity
```

The integrity evaluation is read-only and checks every historical assertion citation against the pinned admitted source. Real model outputs have not been human scored for extraction precision/recall or project classification. Models propose changes; application validation and atomic publication enforce provenance, scope and history. No derived vector index is needed to inspect memory; hybrid Researcher retrieval comes later.

The summary-first weekly evaluation also **writes real memory**, reading the six existing pinned sources without rerunning media extraction. It checks cross-week grouping, separate projects, exact full-text drilldown, historical child pins, unpushed controls and unchanged replay. Run after reviewing the corpus:

```sh
podman run --rm --network chronicler_default -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run eval:chronicler:organized
```

Private timing and integrity reports remain under `data/evaluations/`. Neither this evaluation nor application invariants establish human-scored summary accuracy.
