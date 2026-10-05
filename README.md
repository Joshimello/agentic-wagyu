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

Text/Markdown and meeting video staging work now. Videos use pinned local `OpenMOSS-Team/MOSS-Transcribe-Diarize` inference and the configured Qwen model for visual annotations. Long recordings process in checkpointed three-minute audio sections with timestamps on the original video timeline. Speaker labels belong to each section; matching speakers across sections is unverified. The operational limits are 512 MiB and four hours, with quality and latency measured separately. Correcting labels/text creates a new revision and preserves the original. Export Markdown, JSON, or a portable ZIP containing both transcripts and referenced frames; the ZIP excludes the original recording.

The supplied meetings are kept in ignored `data/recordings/`. Their hashes, durations, and evaluation context are maintained in `evals/meetings.json`. Import once and inspect the processed corpus with:

```sh
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run import:recordings
podman run --rm -v "$PWD/data:/data" -v "$PWD/services/media:/service/source:ro" localhost/chronicler-media:dev python source/test_media.py
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run eval:interpreter:video
```

The import runner checks hashes and skips already imported files. The read-only live evaluation runs after all three uploads are ready; it writes ignored reports under `data/evaluations/`. The media regressions use temporary transformations of actual recording excerpts and remove their temporary assets. No reference transcript or speaker labels have been supplied, so application checks do not establish transcription or diarization accuracy. PPTX/PDF/image adapters, explicit push, Chronicler memory, and Researcher answers are later milestones.
