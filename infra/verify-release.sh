#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
web_image="${CHRONICLER_WEB_IMAGE:-localhost/chronicler-web:local}"
media_image="${CHRONICLER_MEDIA_IMAGE:-localhost/chronicler-media:local}"
podman run --rm --pull=never "$web_image" bun -e '
import { existsSync } from "node:fs";
const excluded=["/app/.env","/app/data","/app/evals","/app/docs","/app/plan.md","/app/AGENTS.md","/app/apps/web/tests","/app/apps/web/tools","/app/apps/web/playwright.config.ts","/app/node_modules/@playwright/test","/app/apps/web/node_modules/@playwright/test","/app/apps/web/node_modules/typescript"];
const required=["/app/apps/web/build","/app/apps/web/drizzle/meta/_journal.json","/app/apps/web/workers/run.ts","/app/apps/web/workers/translate.ts","/app/apps/web/src/lib/server/jobs/operation.ts"];
if(excluded.some(existsSync)||required.some(path=>!existsSync(path)))throw Error("Release inventory mismatch");
console.log(JSON.stringify({webReleaseInventory:"passed",excluded:excluded.length,required:required.length}));'
podman run --rm --pull=never --entrypoint python "$media_image" -c '
import importlib.util, pathlib
root=pathlib.Path("/service")
assert all((root/name).exists() for name in ["app.py","asr.py","media.py","documents.py","document_media.py","uv.lock"])
assert not list(root.glob("test_*.py"))
assert not (root/".env").exists()
assert importlib.util.find_spec("jsonschema") is None
print("Media release inventory: passed")'
