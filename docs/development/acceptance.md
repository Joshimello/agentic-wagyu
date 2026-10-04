# Implementation acceptance

## Lifecycle contracts and local runtime (M0)

Accepted 2026-10-04: six Bun contract tests (21 assertions) and two Python JSON Schema tests pass inside Podman. Tests cover invalid locators/references, immutable revision selection, partial coverage acknowledgment, state transitions and committed query scope. Synthetic meeting video, matching PPTX deck, labeled timing, expected facts and historical A/B/C scenarios are generated from the committed fixture specification. No upload or staging revision grants memory authority.

The pinned MOSS Transformers runtime was tested with PyTorch 2.9.0+cu128, CUDA 12.8, BF16 and SDPA on one CDI-exposed RTX PRO 6000 Blackwell GPU. Cold model load including initial weight download: 26.86 seconds. Thirty-second fixture inference: 2.33 seconds, 1.79 GiB peak allocated GPU memory, 11 segments. Repeated five-minute inference: 17.94 seconds, 2.43 GiB peak allocated memory, 108 segments. Neither output hit the generation limit. Allocated memory is a PyTorch metric, not total GPU reservation. Initial supported duration is capped at five minutes, one inference at a time. Model/cache data persist under ignored `data/cache`.

The frozen synthetic speech evaluation returned perfect normalized transcription and acceptable timestamps but **one speaker label for two synthetic voices**. Runtime feasibility passes M0; the M2 quality gate remains open. This finding must not be hidden by lowering the frozen speaker threshold. A real-meeting quality claim requires human speech recordings; this corpus does not establish that claim.

## Application and durable upload foundation (M1)

Accepted 2026-10-04: four PostgreSQL/Bun integration tests (19 assertions), the Chromium upload/review test, type checking with zero errors/warnings, live official OpenAI SDK text/streaming requests, and fresh development/production image builds pass. PostgreSQL 17 with pgvector 0.8.2 migrates through Drizzle. Identical bytes share one immutable asset while retaining distinct upload context. Tests exercise concurrent publication, retryable unsupported sources, process exit after upload, replay after queue insertion before outbox acknowledgment, and graceful worker exit. No memory commits are created.

The stack runs in rootless Podman, with only localhost:5173 exposed. GPU 0 is visible in the media service. Database/assets survive container replacement and restart. A production image starts and imports worker modules independently of SvelteKit. Web shutdown drains requests and closes PostgreSQL connections; worker shutdown stops dispatch and drains the queue handler. The browser runner uses the real localhost origin, preserving the application CSRF checks. A `--no-cache` web build installs from `bun.lock` and succeeds.

## Video staging (M2)

Implemented and functionally verified 2026-10-04; **not fully accepted because the frozen speaker gate fails**.

The running worker uses the pinned MOSS model and `pro6000/qwen38-flash-next` through the official SDK. The visual agent has one bounded contact-sheet tool (at most three sheets, eight frames each, five rounds). Frame requests use container milliseconds; generated images record requested and actual presentation times. Spoken text is stored independently of observations. Only referenced frames enter the staging manifest. Sparse visual coverage and speaker uncertainty are shown in the UI. Media access is restricted to content-addressed assets; models never receive SQL or arbitrary filesystem tools. An atomic ASR checkpoint survives publication retries.

Live upload → worker → video staging → correction → export → reprocess passed. One recorded run produced four annotations and eight referenced frames. All references resolved, and Friday, 12 customers and green status were recovered. Old revisions survived correction, stale edits returned conflict, byte-range video requests worked, the offline ZIP contained both transcript views and frames with relative links, and reprocessing preserved history. Memory stayed empty throughout. Another run explicitly reported that spoken status and the slide shown at that time differed.

Final regression checks: 15 Bun tests / 56 assertions against a freshly migrated disposable PostgreSQL database; four Python media tests; two Python cross-language schema tests; two Chromium workflow tests; zero type-check errors/warnings. Media tests cover variable frame rates, delayed audio, invalid timestamps and path restrictions. A live MOSS request limited to eight tokens returned `truncated=true`, and regression tests verify that incomplete or invalid ASR output remains visible with explicit warnings. Simultaneous correction/reprocess actions are serialized without overwriting history or adding duplicate retry runs. Release images exclude evaluations/browser reports/model probes and credentials.

| Frozen quality gate | Result |
| --- | --- |
| Normalized word error rate ≤25% | 0%, pass |
| ≥95% turn boundaries within 2 seconds | 100%, pass; observed errors 40–365 ms |
| All visual references valid | 100%, pass |
| Friday, 12 customers, green status recovered | Pass |
| Inference ≤900 seconds; allocated GPU memory ≤80 GiB | Pass, including five-minute benchmark |
| At least two anonymous speakers | **Fail: MOSS returned only S01** |

Two general prompt alternatives did not solve the merged synthetic voices; the default upstream prompt remains in production. Thresholds and fixture gold were not weakened or rewritten. Correcting speaker labels is supported but does not count as a passed automatic diarization gate. Real human meeting speech is needed to assess actual speaker separation, and a model/runtime improvement must pass the unchanged synthetic gate before M2 can be marked fully accepted. Recordings longer than five minutes are deliberately rejected with a visible retryable error until separately benchmarked.
