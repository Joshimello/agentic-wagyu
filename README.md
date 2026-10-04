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
./infra/dev.sh exec web bun test apps/web/tests/foundation.test.ts
```

The foundation integration tests add labeled regression uploads to the database. GPU/model checks and their corpus limits are documented in `docs/development/acceptance.md` and `docs/development/pilot-scope.md`. Use the existing lockfiles for builds. API secrets are passed only to the worker, never to browser code or built images.
