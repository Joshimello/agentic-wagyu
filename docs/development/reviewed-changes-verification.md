# Reviewed changes and speaker-name suggestions verification

Recorded 2026-10-12 on the Windows/WSL Podman workspace.

## Scope

- **What changed?** compares two user-selected admitted meetings of an accepted
  project, labeled Earlier and Later. Chronology is never inferred from
  filenames or upload order; unknown dates produce a warning. The comparison
  freezes the memory snapshot, selected revision IDs and approved-state
  baseline, and publishes pending proposals only.
- Proposals are approved, edited and approved, or rejected. The original model
  proposal is retained; review events append the action, timestamp, reason,
  final values, evidence and reviewer-added fields. Approved item versions are
  immutable. Completion reported in a meeting stays `completion_claimed`;
  `completion_verified` requires an explicit reviewer action, completion
  criteria and supporting evidence.
- Ask scopes record a review-history version and read approved state through
  `approvedState` / `approvedHistory`. Reviewed claims link to their approving
  event; unapproved and rejected proposals are unavailable.
- An independent speaker-identity pass and **Revisit speaker names** retry
  mode add pending, section-scoped name suggestions. They never assign names.

Migrations `0014_aspiring_shotgun` and `0015_even_kat_farrell` are additive.
Existing summaries, admissions, legacy assertion history and saved answers are
unchanged.

## Live configured-model findings

`infra/verify-reviewed-model.sh` first failed with zero proposals. Three
defects were fixed:

1. The comparison step received extracted reports without meeting labels, so
   the model could not tell Earlier from Later statements. Each report and
   evidence quote now carries `earlier`, `later` or `baseline support`.
2. Extraction omitted status reports, such as reported completion, about an
   existing commitment. The extraction and comparison prompts now retain them
   (`project-changes-2-en`).
3. Researcher sent two system messages; the Qwen/vLLM template rejects a
   system message after index 0. They are merged. Rejection feedback now lists
   inspected review references and explains that `reviewRefs` require
   `basis: reviewed`.

After these fixes the live check with `pro6000/qwen38-flash-next` produced two
proposals, kept completion as claimed with no invented owner or deadline,
and Ask cited the edit-approval event with reviewer-supplied ownership.
This is one synthetic workflow check, not a measure of comparison accuracy.

## Verification

- Svelte/TypeScript: zero errors and warnings.
- Bun: 118 unit tests pass, including 11 speaker-identity cases (introductions,
  handoffs, active-speaker labels, misleading participant lists, conflicting
  names, 24-voice and two-search limits, budget deferral, preserved manual
  corrections and cancellation) and 5 change-contract cases.
- Isolated PostgreSQL: all 11 integration suites pass, including 9 reviewed
  changes cases and 6 migration upgrade cases.
- Approval-guard mutations: completion verification, simultaneous approvals
  and superseded baseline support mutations are each detected.
- Chromium: 6 **What changed?**, review, Ask and speaker-only revisit checks
  pass at 1280px and 390px.
- Frozen runtime build passes.

## Rollout

No processing was active. The runtime image was rebuilt and the stack
recreated with `down` / `up -d`, preserving database, evidence and cache
volumes. The new tables exist, the latest applied migration matches 0015,
and `/`, `/changes` and `/api/activity` respond. Existing recordings were not
reprocessed; no identities were assigned, proposals approved or evidence
pushed.

Functional checks do not establish name-recognition accuracy. Live accuracy
checks require reviewed examples from real recordings.
