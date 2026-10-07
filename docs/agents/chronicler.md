# Chronicler worker

Updated: 2026-10-06. Part of the [SvelteKit application plan](../../plan.md). Milestones: M4–M5, recovery in M7, and cleanup in M8.

## Primary summary workflow (2026-10-07)

New pushes use source-linked summaries. A meeting/document has one immutable source overview and chronological semantic segments. A continuing project has topic overviews whose leaves reference those same segment nodes. Each segment owns a complete inclusive source-unit range in its pinned revision, with exact character slices and original locators underneath; unit schema version 1 is retained for historical reads. Source/segment organization for a pinned revision is immutable. Project/topic summaries gain new versions when new evidence arrives.

Read all native/ASR text and each document render in bounded blocks. Existing source-mapped recording frames may supply context. Computational blocks and speaker changes alone are not semantic boundaries; contiguous continuation proposals can merge, while later topic reappearances remain separate chronological segments. Every source unit must be covered exactly once, including context without project assignment. Match broad continuing objectives before specific topics; methods and papers normally stay within a project. An uncertain match retains a separate scope or a source-only segment. A descriptive project label is an organizing interpretation, so an absent catalog match or unknown official title does not require leaving substantive research unassigned. Confirmed dates/people are not inferred from filenames or anonymous speaker codes.

Rebuild affected topic summaries from all active segment summaries, then project summaries from all active topics. Every overview version pins exact child versions. A corrected source is activated only after an explicit push; withdraw its earlier active leaves and rebuild affected overviews, while preserving prior snapshots and evidence. Model checkpoints include model/prompt/payload/image hashes, and stale publication rebuilds against the current memory version. Publication validates complete ranges, source admission, node scopes, immutable identities/history and child pins in the shared transaction.

`organization-2-en` produces English summaries, with Chinese names normalized once using OpenCC. Native text and exact quotes remain unchanged. Warnings preserve partial extraction and attribution/technical uncertainty. Summaries are retrieval/navigation aids rather than independent confirmation. Read-only summary AND source-text search can find details omitted from the prose. User-visible results live at `/memory`; `/memory/nodes/:id` progressively opens children or exact evidence. Model-generated prose still needs human accuracy review.

Run `./infra/test-organization.sh` for isolated PostgreSQL/SDK coverage, retry caching, snapshot/source correction, raw-text search and stale publication. `bun run eval:chronicler:organized` deliberately processes the six real weekly sources and checks exact text coverage, project continuity/separation, child-version pins, unpushed PDF controls and unchanged replay. Podman contains all execution, and private output stays under ignored `data/evaluations/`.

An explicit `organizationMode: "scope"` push fills missing project/topic links for existing non-context segments. It reads their summaries and exact source text, keeps source/segment identities and versions immutable, and only publishes new project/topic versions. It does not remap already assigned discussions or re-admit evidence. This mode has a distinct idempotency fingerprint and rejects unorganized/obsolete sources.

The typed assertion implementation below remains a **legacy comparison workflow**, selected explicitly with `workflow: "assertions"`. Its accepted evidence/history stays intact; new summary pushes do not require entity/assertion extraction.

## Responsibility and execution

Convert explicitly pushed staging revisions into persistent research knowledge. Trigger only from a user-created push batch or an explicit memory correction/re-evaluation action. Completing interpretation, editing staging, or asking a question does not trigger memory ingestion.

The worker lives under `apps/web/src/lib/server/agents/chronicler`. It uses shared Drizzle-backed application services, staging primitives, and raw-asset references. No import database, duplicate source store, separate UI, or agent-owned migrations are needed.

Input: immutable push batch ID and its pinned staging revision selection. Output: proposals plus an atomically published memory commit with per-item dispositions. The application validates and commits; the model has no unrestricted write access.

Run through the shared Bun worker image under Podman, using the app's Drizzle services and database container. Commit each coherent, checked extraction/reconciliation increment. M8 consolidates useful milestone cases into durable memory tests and removes temporary selectors/harnesses; preserve migrations, accepted history, and version provenance.

## Push processing

1. Validate batch state and selected revisions, including recorded acceptance of partial coverage.
2. Load exact text/image primitives and metadata captured by the push. Group related files for context while preserving separate source provenance.
3. Extract typed proposals, validate references/spans, and resolve entity candidates conservatively.
4. Match research efforts by cited objective/scope and resolve named entities within project scope. Retrieve reconciliation candidates by project, schema, state key and lexical/structured similarity.
5. Propose explicit support/conflict/replacement relations; validate evidence and effective dates.
6. Recheck memory version, then commit accepted records/events plus the batch outcome atomically. Serialize publication initially; if the baseline changed, re-evaluate affected proposals before commit.
7. Rebuild the graph directly from accepted relational records. Derived lexical/vector retrieval is deferred to Researcher; no index is required to publish or inspect memory.

Allow a batch to commit with unresolved claims withheld and explained. Every selected item receives an outcome. Infrastructure/validation failure must not leave an invisible partial commit. Store proposal/checkpoint output so retries reuse completed work where valid.

## Assertions and evidence

Initial schema registry: `ProjectGoal`, `Decision`, `Commitment`, `Finding`, `Hypothesis`, `ProblemReport`, `OpenQuestion`. Define role types, optional fields, and exclusive state keys in versioned code. No autonomous schema creation or ontology editor is required.

Use statements with immutable versions and validated JSONB arguments plus relational entity references. Store pinned evidence primitive IDs and optional exact quotations, relational entity references, typed arguments, source-reported effective dates, and model/prompt provenance. Original page coordinates and timestamps remain on the cited staging primitive. Schema-valid output is not proof of content accuracy. [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

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

Immutable versions hold source-reported validity. Append assertion, admission, source-revision replacement and relation events. Projects and scoped entity identities are immutable; a global identity merge/remapping editor is deferred. A pure reducer derives current state/effective intervals without overwriting old versions. Historical tools first restrict evidence/relations/mappings by recorded cutoff, then apply effective-time changes. The implemented assertion date precision is a day; original source timestamps remain in metadata/admissions. Preserve unknown dates; use monotonic commit/event sequence for recording ties.

Example: A assigns Alice to T; B says Bob took over September 20 but is pushed September 26. For September 22, a known-time cutoff before B's commit returns Alice, while one after the commit returns Bob with B's evidence. Both answers are reconstructions of recorded knowledge.

## Verification

M4 tests a video/deck push, unpushed control source, edits during a job, zero-assertion outcomes, model failure, and crashes before/after commit. M5 tests A/B in both arrival orders, a later dispute, corrected-ASR repush, unchanged repush, stale concurrent work, and view rebuild.

Every accepted assertion must have valid evidence. Proposed extraction goals: precision ≥90%, recall ≥80% on human-adjudicated fixtures, with all critical decision/commitment cases correct. All temporal/conflict/retry invariants are strict pass gates. Rebuild projections from accepted records without rerunning a model.

## Implemented project and source boundaries

The extraction prompt compares the actual research objective/scope with a catalog of committed and same-batch candidate projects. A cited paper, algorithm or model is normally a tool/entity or a finding within that effort, not automatically another project. Different methods and weekly progress can share a project. Shared participants, institution or technology are insufficient to merge unrelated work. A meeting may contain multiple efforts. A model match needs an existing catalog ID, cited source evidence, a stated reason and confidence at least 0.90; confidence is not a calibrated accuracy guarantee. Before pushing, the user may force an existing project or create a separate named project. Names/aliases and matching proposals remain in provenance; automatic project renaming or global entity merging is not implemented.

Named entities reuse normalized name/type only within their resolved project. Anonymous/role speaker labels require the same staging revision when matching an existing entity; new recordings or ASR revisions receive separate identities. Names containing speaker codes are treated conservatively too. Anonymous codes do not establish confirmed people. Generated prose is English, Chinese names use one OpenCC conversion, and exact source quotations remain untouched. Application guards prevent relations crossing projects or assertion schemas. Changed numerical findings, conditions, owners or statuses cannot be accepted as identical support. Supersession requires an exclusive state schema, explicit source update quotation and a supported effective date. Unknown dates and ambiguous updates remain conflicts or separate claims. Literal ISO/Chinese full dates and confirmed source metadata can support effective dates; filenames, upload order and visually guessed chart dates cannot. Deadlines require dated source text.

Every text character or page/slide render is supplied in bounded source blocks. This is selective research assertion extraction, not a guarantee that every fact is stored. Existing source-mapped video frames may accompany transcript blocks; Chronicler does not rerun MOSS or randomly sample new frames. Document boilerplate exclusions are enforced at evidence validation while full renders preserve context.

Corrected revisions replace that upload's active support in the reducer only after their new push commits. Older evidence and assertions remain inspectable at earlier recorded snapshots. Independent supporting sources remain active. Publication uses a single database lock, validates the proposal again, and commits all accepted items or rolls back; stale work refreshes against the latest committed snapshot. Durable outbox dispatch and content-keyed model checkpoints support retries without repeated memory effects.

## Maintained acceptance commands

Run `./infra/test-memory.sh` for disposable PostgreSQL regressions covering pinned batches, retries, rollback during publication, concurrent stale work, dated A/B updates in both orders, disputes, corrected sources, no-assertion admissions and history. Standard Bun regressions include the pure temporal reducer and strict evidence/schema guards. Chromium checks exercise the graph, historical view and source viewer.

`bun run eval:chronicler:weekly` inside the development Podman network deliberately pushes the supplied real decks/recordings one by one and checks project continuity/separation and unpushed PDF controls. `bun run eval:memory:integrity` is read-only: it pins a committed version, resolves every historical citation, validates quotations and checks project-scoped relations and unchanged pinned snapshots. Private reports stay under ignored `data/evaluations/`. Precision/recall and project-classification accuracy remain human-unscored; these structural checks do not satisfy the proposed human-adjudicated quality targets.
