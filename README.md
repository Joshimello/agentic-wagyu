# Chronicler

A local SvelteKit application with Bun workers. Interpreter turns uploads into inspectable staging revisions. Explicit pushes let Chronicler organize accepted evidence into source summaries, discussion segments, projects and topics. Researcher follows that graph to original text and images and saves cited answers at a fixed memory snapshot.

## Start locally

Prerequisites: rootless Podman, the pinned Compose provider (`uv tool install podman-compose==1.5.0`), and NVIDIA drivers/CDI for the media runtime. Bun 1.4.2 and Python dependencies are installed inside the images with frozen lockfiles.

Put API credentials in private `.env` using `.env.example`, then:

```sh
./infra/dev.sh up -d --build
./infra/doctor.sh --live
```

Open <http://localhost:5173>. PostgreSQL uses the `chronicler_database` volume; source evidence and caches live under ignored `data/`. Routine `down` preserves them. Never use `down -v` when rebuilding an existing workspace. See [operations](docs/operations.md) for safe rebuilds, GPU selection, model limits, cancellation, restart recovery and verified backups/restores.

## File-to-memory workflow

Upload text, meeting recordings, PPTX, PDFs or images. Staging keeps raw bytes, exact extracted text, renders, source locators, coverage warnings, model/prompt provenance and immutable revisions. Files remain outside memory until you select exact revisions and push them. Partial coverage needs an explicit inclusion choice.

Meetings use pinned local `OpenMOSS-Team/MOSS-Transcribe-Diarize` inference in 30-minute windows and OpenCC Traditional Chinese normalization. Qwen reads the transcript, identifies missing visual context and searches nearby frames. Its review notes and organization are English; inferred speaker names remain tentative and cited. Speaker identity across processing windows is unverified. The transcript reader supports search, corrections and separately cached English/Traditional Chinese reading copies.

PPTX review labels slides and meaningful embedded images/videos and provides a document summary. Repeated logos, classification stamps and decoration retain originals with concise exclusion reasons. PDFs retain native/OCR text and page renders for visual review. Fonts, hidden slides, static media, OCR uncertainty and incomplete interpretation remain visible. Export JSON, Markdown or a portable ZIP with cited derivatives; originals remain independently downloadable.

Corrections create staging revisions and leave accepted memory unchanged. Repushing explicitly accepts the corrected evidence, preserves historical summaries and citations, and keeps unchanged replay idempotent. `/memory` offers source → segment → exact evidence and project → topic → shared segment drilldown. The earlier typed assertion history remains accessible at `/memory/assertions`.

Ask at `/ask`, optionally scoped by project, recorded snapshot or source date. Researcher searches accepted summaries and original text, opens original evidence and images, and returns cited answers with inference/absence/coverage distinctions. Unpushed files and newer unpushed revisions are excluded. Saved answers keep their original scope and citations after later pushes. Current retrieval combines multilingual lexical channels and hierarchy traversal; no embedding or semantic-search coverage is claimed.

## Development and verification

All checks execute in Podman, without requiring host JavaScript dependencies:

```sh
./infra/test.sh check
./infra/test.sh unit
./infra/test.sh integration
./infra/test.sh documents
./infra/test.sh media
./infra/test.sh browser
./infra/test.sh build
```

Integration checks create their own disposable PostgreSQL server and database per suite, preserving workspace data. Document/media/browser checks additionally require the supplied private corpus. The [testing guide](docs/development/testing.md) describes dependencies and the lasting regression coverage. [Maintained evaluations](evals/README.md) cover real-corpus source integrity, organization and model-quality observations; tests/evaluations/history stay outside production images.

A live release workflow uses fresh database/evidence volumes, a real meeting excerpt and full documents, including restart, correction/repush, history and original citations:

```sh
CHRONICLER_PROJECT=chronicler_workflow_example CHRONICLER_PORT=5174 ./infra/verify-workflow.sh
```

Add `--evaluate` for repeated source-holdout questions. Human transcription, organization and answer-quality scoring remains separate from functional checks and same-model automated judgments. See [clean release verification](docs/development/release-verification.md), [acceptance history](docs/development/acceptance.md) and [the lifecycle pilot](docs/development/lifecycle-pilot.md) for recorded evidence and limitations.

Agent contracts are documented for [Interpreter](docs/agents/interpreter.md), [Chronicler](docs/agents/chronicler.md) and [Researcher](docs/agents/researcher.md). The implementation architecture and development history remain in [plan.md](plan.md).
