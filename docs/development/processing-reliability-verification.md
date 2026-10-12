# Local processing reliability verification

Recorded 2026-10-12 on the Windows/WSL Podman workspace.

## Repeated transcription failure

The W2 recording repeatedly exhausted four interpreter attempts. Retained
worker queue errors reported `TimeoutError: The operation timed out` after
approximately five minutes of otherwise active GPU transcription. Bun's
default HTTP idle timeout cut off the request before the explicit media
deadline. Some 30-minute audio windows also require more than the previous
16-minute deadline on the RTX 4080 Laptop GPU.

Local media POSTs now disable the default idle timeout and use an explicit
60-minute transcription deadline, 30-minute document deadline, and 16-minute
deadline for other video operations. Cancellation remains active. Queue
delivery expiry matches the existing four-hour interpreter operation budget.
The transcription model and 30-minute speaker scopes are unchanged.

## Failure visibility and recovery

Source pages expose a lazy Processing details panel before any revision is
available. It shows run history, durable bounded progress logs, redacted
exception causes/tracebacks, reusable audio windows, and live media coverage.
Logs can be copied or downloaded. Historical queue failures are labeled as
such; missing historical progress records are not reconstructed.

Completed audio windows survive retries; an interrupted window starts again.
Validated media cache hits bypass the GPU lock. Invalid requests stop wasting
automatic attempts; transient disconnect/cancellation responses remain
retryable. Queue-backed retry status prevents duplicate manual processing,
keeps the source observable while waiting, and permits canceling queued
automatic retries. Transactional checks use the caller's connection.

## Verification

- Bun: 102 unit tests and 453 assertions pass.
- Isolated PostgreSQL: 13 staging and 11 job-control tests pass.
- Python media: 18 cancellation, cache, progress, and failure tests pass.
- Chromium: four processing-details and ten transcript-workspace checks pass.
- Desktop/mobile failure logs, history selection, downloads, polling, and
  layout fit are checked; screenshots remain private under data/browser-results.
- Removing HTTP 409 retry eligibility in an isolated container makes the
  transient-control regression fail; the workspace source is not mutated.
- Svelte/TypeScript: zero errors and warnings; frozen-dependency runtime builds
  pass. Web, worker, translator, and media are deployed locally.

The first browser request immediately after recreation hit a database connect
timeout. Subsequent API reads and the targeted browser rerun pass; this
startup observation is separate from the original media request timeout.

## Real recording result and limits

W2 upload `93cc9528-96a0-4039-b204-53187bbc7b3f`, run
`51739764-9d5b-480c-9552-8ddddcb5c97a`, completed on its first attempt in
about 35 minutes. The 57-minute-32-second recording has full coverage, 956
ASR entries, and two cached audio windows. It is ready with review warnings
about section-scoped speakers, selected visual searches, and two unresolved
context questions. No sufficiently supported name suggestion was produced.

Memory remains version 2 and W2 is not pushed to memory. Functional completion
does not establish transcript accuracy, speaker identity, or universal
throughput. These changes reduce discarded work and cache contention; model
inference remains the main time cost on this GPU.
