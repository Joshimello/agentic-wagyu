# Staging source organization verification

Recorded 2026-10-12 on the Windows/WSL Podman workspace.

Staging groups use user-supplied project names, with a No project group for
unnamed sources. The existing group-hint field supplies these names, preserving
previously entered labels without creating accepted research-memory projects.
Both upload details and the source editor offer existing staging/memory project
names and Custom. An empty workspace shows only an optional project-name input.

The source editor changes the display name, meeting date/time, and project.
Original filenames remain available and retain the file extension used by the
adapters. Raw bytes, transcript primitives, annotations, and model provenance
remain intact. Edits create immutable metadata revisions when evidence exists;
failed sources without a revision can also be organized. Old selections and
accepted evidence remain pinned until explicitly changed or pushed.

Current revision metadata feeds the list and source editor, including earlier
transcript-editor corrections. Saves synchronize upload metadata for subsequent
processing. Optimistic checks reject stale edits; upload/run locks serialize
saves with worker claims. Active processing and pending retries disable editing.

## Checks

- 102 Bun unit tests pass.
- 16 staging and 11 job-control PostgreSQL checks pass in isolated databases.
- Svelte/TypeScript reports zero errors and warnings.
- A private empty browser workspace passes eight staging/interface checks,
  including first-project creation, dropdown visibility, save/cancel, reload,
  clearing project membership, and desktop/mobile layout. Its real-recording
  case is skipped because the empty workspace has no recording.
- The live workspace passes all 19 staging and transcript browser checks,
  including the real-recording detail editor, speaker review, pinned revisions,
  translations, and responsive layout. Browser writes are intercepted.
- Inverting the current-revision condition in a disposable container makes the
  metadata-history regression fail. The repository source is not mutated.
- Frozen runtime builds pass. The web service is updated independently so the
  in-progress CGV recording continues on its original worker attempt.

Screenshots and test databases are private disposable artifacts. Verification
does not assign projects or dates to user sources or push staging into memory.
