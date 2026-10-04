# Chronicler worker

Updated: 2026-10-05. Part of the [SvelteKit application plan](../../plan.md). Milestones: M4–M5, recovery in M7, and cleanup in M8.

## Responsibility and execution

Convert explicitly pushed staging revisions into persistent research knowledge. Trigger only from a user-created push batch or an explicit memory correction/re-evaluation action. Completing interpretation, editing staging, or asking a question does not trigger memory ingestion.

The worker lives under `apps/web/src/lib/server/agents/chronicler`. It uses shared Drizzle-backed application services, staging primitives, and raw-asset references. No import database, duplicate source store, separate UI, or agent-owned migrations are needed.

Input: immutable push batch ID and its pinned staging revision selection. Output: proposals plus an atomically published memory commit with per-item dispositions. The application validates and commits; the model has no unrestricted write access.

Run through the shared Bun worker image under Podman, using the app's Drizzle services and database container. Commit each coherent, checked extraction/reconciliation increment. M8 consolidates useful milestone cases into durable memory tests and removes temporary selectors/harnesses; preserve migrations, accepted history, and version provenance.

## Push processing

1. Validate batch state and selected revisions, including recorded acceptance of partial coverage.
2. Load exact text/image primitives and metadata captured by the push. Group related files for context while preserving separate source provenance.
3. Extract typed proposals, validate references/spans, and resolve entity candidates conservatively.
4. Retrieve committed-memory candidates by schema, project, activity, participants, state key, and similarity.
5. Propose explicit support/conflict/replacement relations; validate evidence and effective dates.
6. Recheck memory version, then commit accepted records/events plus the batch outcome atomically. Serialize publication initially; if the baseline changed, re-evaluate affected proposals before commit.
7. Queue/retry derived indexing. A post-commit indexing failure cannot repeat the knowledge write.

Allow a batch to commit with unresolved claims withheld and explained. Every selected item receives an outcome. Infrastructure/validation failure must not leave an invisible partial commit. Store proposal/checkpoint output so retries reuse completed work where valid.

## Assertions and evidence

Initial schema registry: `ProjectGoal`, `Decision`, `Commitment`, `Finding`, `Hypothesis`, `ProblemReport`, `OpenQuestion`. Define role types, optional fields, and exclusive state keys in versioned code. No autonomous schema creation or ontology editor is required.

Use statements with immutable versions and validated JSONB arguments plus relational entity references. Store evidence primitive IDs/spans/regions, attribution, source-reported validity, extraction provenance, and assertion/verification status. Schema-valid output is not proof of content accuracy. [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Use `pro6000/qwen38-flash-next` through the environment-configured OpenAI-compatible gateway for development extraction/reconciliation. Simple JSON Schema output passed the gateway smoke test; continue application-side validation and corpus quality checks.

Preserve uploader/author/speaker distinctions. Anonymous speakers are recording/run-scoped; a confirmed mapping is attributed evidence, not a license to merge similar names globally. Treat paper claims as attributed claims, not automatically accepted lab findings. Keep units, experimental conditions, negation, and uncertainty.

Visual assertions require inspected images/regions. A caption is interpretation, not quotation. Original image, OCR, caption, and Markdown renderings share source lineage and are not independent evidence. Researcher answers and project summaries cannot become evidence automatically.

## Reconciliation and corrected pushes

| Case | Required behavior |
| --- | --- |
| Retry/double-click/unchanged incorporated revisions | No duplicate memory effect. |
| Equivalent attributed assertion with matching scope/time/conditions | Reuse identity cautiously; append new support with provenance. |
| Explicit task status update | Append a version to the identified commitment. |
| Explicit replacement decision | Add replacement/supersession with source and effective time. |
| Unresolved disagreement | Keep both; flag conflict instead of selecting by confidence/arrival order. |
| Different experiment conditions | Keep distinct findings. |
| Older meeting pushed later | Reconstruct effective history without treating push order as event order. |
| Corrected ASR/OCR/staging revision pushed | Compare changed support, append correction/retraction events, retain earlier evidence and history. |

An Interpreter rerun changes source representation, not necessarily the underlying research event. New staging alone has no effect. A corrected push must not retain incompatible old and new extraction merely because both runs completed; update support and accepted-state events explicitly. No-assertion input may be admitted as source context with that outcome disclosed.

## Time and durable memory

Separate source time, staging creation, push action, memory commit time, and assertion effective time. `knownAt` uses memory acceptance history; an upload sitting in staging was not yet known to memory.

Immutable versions hold source-reported validity. Append events for later closures, replacements, corrections, and entity-resolution changes. A pure reducer derives current state/effective intervals without overwriting old versions. Historical tools first restrict evidence/relations/mappings by recorded cutoff, then apply effective-time changes. Preserve date precision and unknown dates; use monotonic commit/event sequence for recording ties.

Example: A assigns Alice to T; B says Bob took over September 20 but is pushed September 26. For September 22, a known-time cutoff before B's commit returns Alice, while one after the commit returns Bob with B's evidence. Both answers are reconstructions of recorded knowledge.

## Verification

M4 tests a video/deck push, unpushed control source, edits during a job, zero-assertion outcomes, model failure, and crashes before/after commit. M5 tests A/B in both arrival orders, a later dispute, corrected-ASR repush, unchanged repush, stale concurrent work, and view rebuild.

Every accepted assertion must have valid evidence. Proposed extraction goals: precision ≥90%, recall ≥80% on human-adjudicated fixtures, with all critical decision/commitment cases correct. All temporal/conflict/retry invariants are strict pass gates. Rebuild projections from accepted records without rerunning a model.
