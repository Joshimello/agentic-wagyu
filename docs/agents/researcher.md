# Researcher worker

Updated: 2026-10-05. Part of the [SvelteKit application plan](../../plan.md). Milestones: M6–M7, with cleanup in M8.

## Responsibility and trigger

Answer questions using committed research memory and its admitted source evidence. Trigger from the Ask UI. The application stores a research run, captures a memory snapshot, and schedules the query on a lane with capacity reserved for interactive work. The UI streams/polls progress and receives the validated answer.

Researcher is under `apps/web/src/lib/server/agents/researcher`. Its tools are read-only application services using the shared Drizzle/retrieval/storage layer. It can trace sources without running media ingestion or changing research memory. Persisting messages, citations, usage, and run status is application bookkeeping, not agent memory write access.

Run through Bun in the Podman worker container with reserved query capacity. Commit checked retrieval/answer changes in small coherent increments. M8 removes temporary QA/demo harnesses and generated reports while retaining lasting staging-isolation, snapshot, citation, and read-only-access tests; keep maintained quality evaluations separate from release images.

Use `pro6000/qwen38-flash-next` through the environment-configured OpenAI-compatible gateway for development answers. Basic tool/result round trips and streaming passed; full agent SDK behavior and answer quality remain integration/evaluation work.

## Query contract and scope

Input: question, optional conversation context/project/time scope, and an application-supplied memory snapshot. Default snapshot is the latest committed memory revision when the run starts. Historical questions can specify both `effectiveAt` and `knownAt`; otherwise make the interpretation explicit.

All tool results, current-state projections, vector/lexical indexes, source resolutions, and caches must obey this scope. A concurrent push must not change the evidence universe midway through an answer. If an index lags, use authoritative structured/lexical data or report incomplete search; do not claim completeness from stale results.

Unpushed staging is excluded even though its records share the database. New unpushed revisions of an incorporated source are also excluded. Source access resolves IDs and admitted lineage, never arbitrary paths or the latest staging pointer.

## Tools

```text
searchMemory(query, filters, limit)
getProjectState(projectId, effectiveAt?)
getEntityContext(entityId, effectiveAt?)
getChanges(projectId, from, to, timeAxis)
getStatementHistory(statementId)
getEvidence(primitiveIds)
openSourceContext(evidenceId, boundedRangeOrRegion?)
```

Snapshot/project/known-time access constraints are injected by application context and cannot be widened by model arguments. Validate requested IDs and bounds against completed push membership.

Use structured queries for assignments/decisions/open questions, temporal events for changes, lexical/vector retrieval for similar problems, and bounded relations for rationale. Begin with exact pgvector search plus PostgreSQL full-text retrieval and rank fusion; approximate indexes can follow measured need. [pgvector documentation](https://github.com/pgvector/pgvector).

For visual evidence, search source-linked text/metadata/annotations and then load actual frame/slide/page primitives. A text embedding model does not itself provide image embeddings. Fetch readable regions for numeric/diagram claims; abstain if evidence is unreadable.

Suggested initial budgets: 20 candidates per retrieval channel, up to 12 text evidence units plus a separate image budget, two relationship hops, and a bounded total tool-call/token count. These are tuning values. Structured enumerations must paginate or disclose truncation. Test lexical segmentation on actual corpus languages.

## Reasoning and answer contract

1. Determine question scope and retrieve relevant memory.
2. Inspect supporting and conflicting evidence, expanding original context within pushed sources when necessary.
3. Distinguish accepted assertions, source observations, and answer-time inference.
4. Return answer blocks with evidence IDs, uncertainty/conflict notices, and time scope.
5. Application code validates every citation against the run scope, renders links, and stores answer/citation/snapshot records. Human evaluation measures whether evidence supports the prose; a valid ID alone is insufficient.

When inspecting admitted raw source context reveals something not extracted into memory, it may be used as labeled source-based analysis. It is not silently saved as canonical knowledge. A later memory correction/re-evaluation remains an explicit action through the app.

Never fabricate missing rationale, erase disagreements in a summary, or treat prior chat as research evidence. Ask a clarifying question when necessary or state insufficient evidence. Generated answers and summaries are not source documents.

Citations open the common viewer at the exact version/page/slide/time/region. Preserve original question/answer scope so historical answers can still be inspected after new memory commits.

## Verification

Use approximately 40 questions spanning project goals, decisions, assignments, open questions, rationale, recurring problems, and changes between meetings. Include visual-only evidence, absent-answer cases, unpushed decoy files, newer unpushed corrections, historical cutoffs, and a push completing during a query.

Strict gates: 100% valid in-scope citation IDs; zero unpushed-source leakage; no memory mutation; all critical temporal/conflict questions correct. Proposed quality goals: evidence recall@10 ≥90%, fully correct answers ≥85%, and ≥95% of factual claims supported by cited evidence. Human review is the final semantic-support gate; a model judge may assist.

Reserve at least two sources/ten questions as holdout where feasible. Report counts and three-run model variability, query latency, and usage. Compare against fragment-only retrieval using the same generation model. Recovery tests cover cancellation, duplicate delivery, server/worker restart, and source/index unavailability without publishing unsupported answers.
