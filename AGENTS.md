# Development instructions

Follow the architecture and lifecycle in [plan.md](plan.md).

- Use Bun primarily for JavaScript/TypeScript dependencies, workspaces, runtime, scripts, and suitable tests. Commit `bun.lock` and use frozen dependency installs in builds. Python remains appropriate for the media/model runtime.
- Contain development, checks, migrations, and release execution with Podman. Keep Containerfiles/orchestration under `infra/`; web and workers use Bun, while media dependencies run in a separate Python/GPU container. Preserve data/cache volumes during routine rebuilds.
- When implementation starts, initialize Git if needed and commit the reproducible foundation. Commit regularly after coherent, checked features, fixes, migrations, and refactors; make multiple commits within long milestones. Inspect staged changes, exclude secrets/generated data, and keep commits local unless publishing is requested.
- Keep production code and UI organized around product behavior rather than milestone IDs. Remove temporary milestone traces, demo/test harnesses, throwaway fixtures, debug instrumentation, and generated reports during M8.
- Retain lasting regression tests for staging isolation, pinned revisions, retries/idempotency, history, citations, and the full user workflow. Consolidate valuable temporary tests before removing their scaffolding. Rebuild and verify the cleaned code before committing cleanup.
- Cleanup preserves raw evidence, accepted memory/history, migrations, required operational observability, and model/prompt provenance. Keep maintained evaluations and development history out of release images.
