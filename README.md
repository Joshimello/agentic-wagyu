# Chronicler

A local SvelteKit application with Bun workers. Uploads become inspectable staging revisions. Staging is isolated from memory; explicit push and memory/question workflows are later implementation steps.

Prerequisites: Bun 1.4.2, rootless Podman, NVIDIA drivers and CDI, and the pinned compose launcher (`uv tool install podman-compose==1.5.0`). The media container gets only GPU 0. Services other than the web app stay on the private container network.

Put the configured API credentials in private `.env` (see `.env.example`). Then:

```sh
./infra/dev.sh up -d --build
```

Open http://localhost:5173. PostgreSQL lives in the `chronicler_database` named volume; raw/derived assets and model caches live under ignored `data/`. `./infra/dev.sh down` preserves those records. Do not use `down -v` unless deliberately deleting the database.

Run development checks in Podman:

```sh
podman run --rm -v "$PWD:/app" -w /app docker.io/oven/bun:1.4.2 bun run check
podman run --rm -v "$PWD:/app" -w /app docker.io/oven/bun:1.4.2 bun run test:contracts
./infra/test.sh
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

The import runner checks hashes and skips already imported files. The read-only live evaluation runs after all three uploads are ready; it writes ignored reports under `data/evaluations/`. The media regressions use temporary transformations of actual recording excerpts and remove their temporary assets. No reference transcript or speaker labels have been supplied, so application checks do not establish transcription or diarization accuracy. Explicit push, Chronicler memory, and Researcher answers are later milestones.

## Documents and saved selections

PPTX, PDF and single-image staging are available. Select multiple files in one upload to group them with an optional project hint. Grouping is context, not evidence that a deck was discussed in a recording. Select ready sources on the staging list to save exact revisions. Corrections leave the old revision pinned and show a switch-to-current action. Partial extraction needs an explicit include choice; memory ingestion remains unavailable until Chronicler is implemented.

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
