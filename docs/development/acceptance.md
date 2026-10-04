# Implementation acceptance

## Lifecycle contracts and local runtime (M0)

Accepted 2026-10-05: six Bun contract tests (21 assertions) and two Python JSON Schema tests pass inside Podman. Tests cover invalid locators/references, immutable revision selection, partial coverage acknowledgment, state transitions and committed query scope. Synthetic meeting video, matching PPTX deck, labeled timing, expected facts and historical A/B/C scenarios are generated from the committed fixture specification. No upload or staging revision grants memory authority.

The pinned MOSS Transformers runtime was tested with PyTorch 2.9.0+cu128, CUDA 12.8, BF16 and SDPA on one CDI-exposed RTX PRO 6000 Blackwell GPU. Cold model load including initial weight download: 26.86 seconds. Thirty-second fixture inference: 2.33 seconds, 1.79 GiB peak allocated GPU memory, 11 segments. Repeated five-minute inference: 17.94 seconds, 2.43 GiB peak allocated memory, 108 segments. Neither output hit the generation limit. Allocated memory is a PyTorch metric, not total GPU reservation. Initial supported duration is capped at five minutes, one inference at a time. Model/cache data persist under ignored `data/cache`.

The frozen synthetic speech evaluation returned perfect normalized transcription and acceptable timestamps but **one speaker label for two synthetic voices**. Runtime feasibility passes M0; the M2 quality gate remains open. This finding must not be hidden by lowering the frozen speaker threshold. A real-meeting quality claim requires human speech recordings; this corpus does not establish that claim.

## Application and durable upload foundation (M1)

Accepted 2026-10-05: four PostgreSQL/Bun integration tests (19 assertions), the Chromium upload/review test, type checking with zero errors/warnings, live official OpenAI SDK text/streaming requests, and fresh development/production image builds pass. PostgreSQL 17 with pgvector 0.8.2 migrates through Drizzle. Identical bytes share one immutable asset while retaining distinct upload context. Tests exercise concurrent publication, retryable unsupported sources, process exit after upload, replay after queue insertion before outbox acknowledgment, and graceful worker exit. No memory commits are created.

The stack runs in rootless Podman, with only localhost:5173 exposed. GPU 0 is visible in the media service. Database/assets survive container replacement and restart. A production image starts and imports worker modules independently of SvelteKit. Web shutdown drains requests and closes PostgreSQL connections; worker shutdown stops dispatch and drains the queue handler. The browser runner uses the real localhost origin, preserving the application CSRF checks. A `--no-cache` web build installs from `bun.lock` and succeeds.
