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

The regression runner migrates a fresh disposable PostgreSQL database and uses a separate storage directory; it does not write to your workspace database. Browser and live video evaluations add labeled test uploads to the running workspace. GPU/model checks and their corpus limits are documented in `docs/development/acceptance.md` and `docs/development/pilot-scope.md`. Use the existing lockfiles for builds. API secrets are passed only to the worker, never to browser code or built images.

Text/Markdown and meeting video staging work now. Videos use the pinned `OpenMOSS-Team/MOSS-Transcribe-Diarize` model on the local GPU and the configured Qwen model for visual annotations. The measured pilot limit is **five minutes per video**. Speaker labels are anonymous and must be checked; MOSS merged both synthetic voices in the frozen fixture. Correcting labels/text creates a new revision and preserves the original. Download Markdown, JSON, or an offline ZIP with both transcripts and referenced frames. The ZIP excludes the original recording.

To regenerate and run maintained media checks:

```sh
podman run --rm -v "$PWD/data:/data" -v "$PWD/evals:/evals:ro" -v "$PWD/services/media:/service/source:ro" localhost/chronicler-media:dev python source/fixtures.py
podman run --rm -v "$PWD/data:/data" -v "$PWD/services/media:/service/source:ro" localhost/chronicler-media:dev python source/test_media.py
podman run --rm --network chronicler_default -e DATABASE_URL=postgres://chronicler:local-only@database:5432/chronicler -v "$PWD:/app" -v "$PWD/data:/data" -w /app docker.io/oven/bun:1.4.2 bun run eval:interpreter:video
```

The live video runner proves application behavior and visual references. `services/media/evaluate.py` evaluates the separately frozen speech gates, including the currently failing speaker threshold. Do not interpret a successful application test as a passed diarization quality gate. PPTX/PDF/image adapters, explicit push, Chronicler memory and Researcher answers are later milestones.
