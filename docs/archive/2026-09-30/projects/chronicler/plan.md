# Archived: Chronicler — implementation plan

Superseded on 2026-10-04. This separate-project design is historical; see the active root plan and docs/agents/chronicler.md.

Updated: 2026-09-30. Retains the original knowledge/history requirements while moving source ingestion to [Interpreter](../interpreter/plan.md). See the [monorepo plan](../../plan.md) for the shared contract.

## 1. Responsibility

Consume Evidence Bundles and maintain what researchers claimed, decided, tried, discovered, and left unresolved. Answer with evidence and preserve changes across meetings. Chronicler owns research schemas, cross-source entity resolution, assertions, reconciliation, history, retrieval, and answers.

It must run from frozen bundles without Interpreter or GPU/media libraries. Use SvelteKit, TypeScript, Drizzle, PostgreSQL/pgvector, Luna for generation, and a separately configured embedding model. Optional query-agent orchestration stays behind an adapter; persistent memory belongs to the database.

## 2. Import and source handling

1. Validate contract version, hashes, source/primitive references, roles, revision identity, and coverage. Reject incompatible major versions.
2. Create an idempotent import receipt and local immutable manifest/evidence assets. Raw media inclusion is configurable; missing original availability is visible.
3. Index source text, ASR/OCR, notes, visual annotations, and their linked images without collapsing their provenance.
4. Construct bounded evidence windows by reading order/time, with relevant actual images. A caption helps discovery but does not replace visual evidence.
5. Extract, validate, reconcile, publish, and index knowledge in checkpointed stages.

Repeated revisions are no-ops. A new Interpreter revision represents corrected extraction, not automatically a new real-world event. Compare its candidate assertions with the previous revision. If an old assertion loses support, append a correction/invalidation/review event with the reason; preserve earlier evidence/history. Do not leave incompatible extraction revisions active merely because both processing runs completed.

A frame, its OCR, its caption, and enriched Markdown share lineage. Do not ingest exported Markdown again as independent evidence. Citation resolution must work from imported assets with Interpreter offline.

## 3. Canonical model

| Records | Purpose |
| --- | --- |
| `imports`, `evidence_bundles`, `evidence_primitives`, `evidence_links` | Immutable imported representation, source/run identity, roles, hashes, locators, coverage. |
| `processing_runs` | Stored proposals, model/prompt/schema/pipeline versions, usage, errors, publication checkpoints. |
| `entities`, `entity_aliases`, `entity_resolution_events` | Stable identities and reversible, historically scoped resolution mappings. |
| `activities` | Stable meeting/task/experiment identity; status/ownership changes live in assertions. |
| `statement_schemas` | Immutable versioned registry seeded from code. |
| `statements`, `statement_versions` | Stable assertion identity, immutable content, arguments JSONB, attribution, validity, assertion/verification status, recorded time. |
| `statement_entity_refs` | Foreign-key-validated role/entity links alongside JSONB. |
| `statement_evidence` | Primitive IDs/spans/regions, evidence role, recorded time, and path to source. |
| `statement_relations`, `knowledge_events` | Version-specific relationships and append-only acceptance/replacement/retraction/resolution/correction events. |
| Embeddings/current projections | Disposable indexes/views keyed by source/model/projection version. |

Initial schemas: `ProjectGoal`, `Decision`, `Commitment`, `Finding`, `Hypothesis`, `ProblemReport`, `OpenQuestion`. Define required roles, entity types, optional fields, and exclusive state keys in code. Do not build an ontology editor or let the model invent schemas during ingestion.

## 4. Extraction policy

- Model proposals use structured output followed by application validation. Output shape does not guarantee correct content. [OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs)
- Separate uploader, document author, anonymous speaker, and researcher. A cited paper's claim is not automatically the lab's finding.
- Resolve known unique aliases within context; preserve ambiguity. S01 is source/run-scoped. User-confirmed names are attributed mappings, not permission to merge every similar name.
- Require valid source evidence for accepted extracted assertions. Visual claims cite inspected images/regions; generated captions are interpretations, not direct quotations.
- Preserve numeric values, units, conditions, and negation. Extraction confidence is not scientific certainty or calibrated verification.
- Chat answers, summaries, and unsupported inferences never become evidence automatically.
- Start with roughly 2,000–4,000 text tokens/window and a separate bounded image budget; tune on fixtures. Evidence identity does not depend on window boundaries.
- Save prompts/proposals/versions. Rebuild projections from accepted records without LLM calls; fresh model extraction creates new candidates.

## 5. Reconciliation and time

Candidate lookup uses project, schema, participants, activity, state key, and semantic similarity. Similarity alone cannot establish identical claims, contradiction, or precedence.

| Situation | Behavior |
| --- | --- |
| Same evidence processed again | Idempotent no-op. |
| Equivalent attributed claim, matching conditions | Reuse identity cautiously and append supporting source evidence. |
| Explicit status update | Version the identified commitment. |
| Explicit replacement decision | Add replacement/supersedes relation with evidence and effective time. |
| Incompatible claims without resolution | Keep both, mark conflict; do not choose by arrival order/confidence. |
| Different experimental conditions | Keep distinct findings. |
| Older source imported late | Reconstruct affected history using source dates and explicit relationships. |
| Corrected Interpreter representation | Re-evaluate affected assertions; append correction/retraction events and preserve prior citations. |
| User correction | Store an attributed correction note and reversible resolution event. |

Maintain `effectiveAt` (time being asked about) separately from `knownAt` (what Chronicler had recorded). Interpreter processing time and Chronicler import/acceptance time are separate. Unknown source time remains unknown; date-only sources retain precision/timezone information.

Immutable versions contain source-reported validity. Later closures/replacements are events with effective and recorded times. A pure reducer derives intervals/current state without rewriting old versions. Filter evidence, entity mappings, and relationships by recorded cutoff before applying effective-time changes. Use a database sequence for recording ties; genuinely ambiguous temporal order stays unresolved.

Example: A says Alice owns T. B says Bob took over on September 20, but B is imported September 26. For September 22, `knownAt` September 25 returns Alice; `knownAt` September 27 returns Bob with B's evidence. This reconstructs recorded knowledge, not certain historical truth.

Serialize publication per workspace initially. Keep model calls outside transactions; recheck the workspace revision before committing if candidates changed. Publish accepted assertions/events atomically. Operational stages are `imported → extracting → reconciling → indexing → ready`, with explicit warnings/failures and separate knowledge/search readiness.

## 6. Retrieval and answers

```text
searchEvidence(query, project?, effectiveAt?, knownAt?, limit)
getProjectState(projectId, effectiveAt?, knownAt?)
getEntityContext(entityId, effectiveAt?, knownAt?)
getChanges(projectId, from, to, timeAxis, knownAt?)
getStatementHistory(statementId, knownAt?)
getEvidence(primitiveIds, knownAt?)
```

Combine structured/temporal queries, lexical retrieval, exact vector search, and bounded relationship traversal. pgvector supports combining vector and PostgreSQL full-text search; defer approximate indexes until measured latency justifies the recall tradeoff. [pgvector documentation](https://github.com/pgvector/pgvector)

For images, initially retrieve linked text/metadata/annotations, then supply actual image primitives to the VLM. A text embedding model does not automatically embed images. Direct visual-vector retrieval can follow if measured recall requires it. Keep `text-embedding-3-small` as the proposed initial text embedding adapter, with dimensions/model pinned during foundation work.

Initial tuning: 20 candidates/channel, rank fusion, up to 12 text evidence units and a separate image budget; relation traversal up to two hops. Structured lists paginate or disclose truncation. All paths enforce project and time constraints, including graph traversal and snapshots. Undated evidence cannot establish a dated change. Test lexical segmentation on the actual corpus languages.

Answers contain blocks, evidence IDs, interpreted time scope, and uncertainty/conflict notices. Code validates citation references; human review checks semantic support. Visual inference cites images and is labeled; spoken assertions cite transcript segments. Abstain when evidence is absent or unreadable. Query tools are read-only, bounded, and do not accept arbitrary SQL or mutate sources.

## 7. Testable milestones

### C1 — Import and evidence browser

**Depends on:** S0; frozen bundles are sufficient.

**Deliver:** standalone app shell, migrations, validator/import receipt, local evidence storage/viewer.

**Test:** `pnpm --filter chronicler test:milestone C1`: duplicate revisions, incompatible schema, corrupt hashes, missing assets, partial coverage, updated bundle, Interpreter offline.

**Pass:** one import per revision, atomic visibility, explicit omissions, and locally resolvable citations. Historical representations remain inspectable. App/tests require no GPU dependencies.

### C2 — Research assertion extraction

**Depends on:** C1.

**Deliver:** schema registry, Luna adapter, proposals, evidence validation, entity resolution, inspection UI.

**Test:** `pnpm --filter chronicler eval:extract`; deterministic fixtures for false IDs, unsupported quotes, ambiguous speakers, duplicate renderings, and image-dependent assertions.

**Pass:** 100% valid published evidence references; proposed development targets of at least 90% assertion precision and 80% recall; all critical decisions/commitments recovered. Numeric visual claims require readable supporting images. Report results by modality/schema.

### C3 — Knowledge changes and history

**Depends on:** C2.

**Deliver:** candidate reconciliation, event ledger, history reducer, current projection, historical retrieval, corrections.

**Test:** `pnpm --filter chronicler test:milestone C3`: A/B in both arrival orders; C disputes B; corrected ASR word/number; retries; user correction/compensation; projection rebuild.

**Pass:** all critical cases preserve evidence and produce correct current/effective/known-time answers. Conflicts remain visible. Source representation corrections differ from research events. Final effective history agrees across arrival orders where source evidence establishes ordering; recorded history correctly differs. Rebuild needs no LLM calls.

### C4 — Retrieval and evidence-backed answers

**Depends on:** C3.

**Deliver:** hybrid retrieval, temporal/structured tools, text/image evidence assembly, source-linked answers, optional bounded query agent.

**Test:** `pnpm --filter chronicler eval:qa` covers assignments, rationale, unresolved issues, history, absent evidence, and a fact only visible on a frame/slide. Compare with fragment-only RAG using the same generation model.

**Pass:** proposed targets: evidence recall@10 ≥90%, fully correct answers ≥85%, valid citation IDs 100%, factual claims supported by citations ≥95%. All critical history/conflict cases pass; no future evidence leaks. Human adjudication is the release gate; an LLM judge can assist.

### C5 — Integrated pilot and recovery

**Depends on:** C4 and I4; include I5 before declaring all requested input formats supported.

**Deliver:** publication → import → ask → original context; local setup docs; usage/budget controls; backups; frozen holdout report.

**Test:** `pnpm verify:mvp`: reserved sources/questions, crashes around publication/import acknowledgment, API downtime, corrupt bundle, complete backup/restore, and browser walkthrough.

**Pass:** no duplicate accepted knowledge, lost committed state, or dangling citations. Restored history matches; holdout meets C2/C4 quality targets with counts and three-run variability reported. Measure cost/latency on the documented hardware/corpus. The complete UI flow needs no SQL/developer tools.

## 8. Evaluation and operations

Start with 6–10 related sources/~40 questions and reserve two sources/ten questions as holdout where feasible. Include replacement, contradiction, reassignment, answered question, similar names, unknown dates, out-of-order import, corrected ASR, and visual-only evidence. Synthetic data tests mechanics; real reviewed material tests usefulness.

Separate representation, extraction, reconciliation, retrieval, and answer failures. Count semantic correctness with attribution/conditions rather than exact generated wording. Report numerators/denominators and failure categories; small pilot percentages do not establish broad reliability.

Keep credentials server-side, services on loopback, uploaded instructions untrusted, and retries checkpointed. Track API usage separately from GPU/storage costs. A configurable spending cap is required; no amount or deadline has been agreed. The original USD 5/day suggestion remains a planning default only. Preserve appropriate provider data controls under the existing hosted-API permission.

Backup manifests, evidence assets, accepted records, model proposals, and corrections together. Raw-file-only backup cannot restore accepted history. Embeddings/current projections are disposable; accepted interpretations are not reconstructed by assuming fresh model output will match.
