# Implementation acceptance

## Lifecycle contracts and local runtime (M0)

Accepted 2026-10-05: six Bun contract tests (21 assertions) and two Python JSON Schema tests pass inside Podman. Tests cover invalid locators/references, immutable revision selection, partial coverage acknowledgment, state transitions and committed query scope. Synthetic meeting video, matching PPTX deck, labeled timing, expected facts and historical A/B/C scenarios are generated from the committed fixture specification. No upload or staging revision grants memory authority.

The pinned MOSS Transformers runtime was tested with PyTorch 2.9.0+cu128, CUDA 12.8, BF16 and SDPA on one CDI-exposed RTX PRO 6000 Blackwell GPU. Cold model load including initial weight download: 26.86 seconds. Thirty-second fixture inference: 2.33 seconds, 1.79 GiB peak allocated GPU memory, 11 segments. Repeated five-minute inference: 17.94 seconds, 2.43 GiB peak allocated memory, 108 segments. Neither output hit the generation limit. Allocated memory is a PyTorch metric, not total GPU reservation. Initial supported duration is capped at five minutes, one inference at a time. Model/cache data persist under ignored `data/cache`.

The frozen synthetic speech evaluation returned perfect normalized transcription and acceptable timestamps but **one speaker label for two synthetic voices**. Runtime feasibility passes M0; the M2 quality gate remains open. This finding must not be hidden by lowering the frozen speaker threshold. A real-meeting quality claim requires human speech recordings; this corpus does not establish that claim.
