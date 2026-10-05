# Real meeting evaluation scope

`evals/meetings.json` identifies the three supplied recordings by SHA-256 and container duration. Original videos live under ignored `data/recordings/`; imported originals also use the normal content-addressed asset storage. They are private local evidence and are never included in Git or container images. The filename is a source label, not a verified event timestamp.

The user describes mostly Mandarin Chinese, usually one person speaking at a time, with perhaps ten participants. This is context, not labeled reference data, and must never become a required model speaker count.

All three meetings passed application and browser checks on 2026-10-05; detailed measurements are in `acceptance.md`.

The Interpreter processes contiguous three-minute audio sections, with per-section checkpoints and original-container timestamp offsets. It caches normalized mono audio once per source. Speaker IDs are scoped to their audio section; an S01 in two sections does not establish that they are the same person. Section boundaries can split phrases. Cross-section speaker reconciliation remains unimplemented.

The upload limit remains 512 MiB, and the operational duration ceiling is four hours. This ceiling is a resource bound, not a quality or latency guarantee. The supplied corpus ranges from approximately 65 to 157 minutes. One local GPU inference runs at a time. Each visual attempt uses at most 24 frames (one failed attempt can be retried) and a time-distributed sample of at most 120 transcript segments; the full extracted transcript remains available in staging.

Maintained application checks require the full container duration, valid primitive locators and evidence references, nonempty speech and visual annotations, readable frames, pinned JSON exports, portable offline bundles, original-video range requests, and zero memory commits. Browser checks are read-only on the imported meetings. Correction/concurrency/history/retry regression tests use an isolated disposable database and storage directory.

No human transcript or speaker-reference labels have been provided. Transcription accuracy, diarization error rate, and cross-section speaker identity are explicitly unreviewed. Before accepting a quality claim, review time-stratified excerpts from each meeting, including different voices and speaker changes, annotate verbatim Chinese speech and speaker intervals, and freeze corpus-specific quality thresholds before measuring them. Do not infer accuracy from label counts or from successful API responses.

The previous generated-media pilot and its artificial speaker threshold were retired at the user's request. Its earlier measurements remain in Git history; they no longer gate this corpus. No made-up facts or edits are inserted into the real meetings.
