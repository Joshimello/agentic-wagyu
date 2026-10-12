# Researcher worker

Updated: 2026-10-11. Part of the [SvelteKit application plan](../../plan.md).

## Responsibility and trigger

Answer questions using committed research memory and its admitted source evidence. Trigger from the Ask UI. The application stores a research run, captures a memory snapshot, and schedules the query on a lane with capacity reserved for interactive work. The UI streams/polls progress and receives the validated answer.

Researcher is under `apps/web/src/lib/server/agents/researcher`. Its tools are read-only application services using the shared Drizzle/retrieval/storage layer. It can trace sources without running media ingestion or changing research memory. Persisting messages, citations, usage, and run status is application bookkeeping, not agent memory write access.

Run through Bun in the Podman worker container with reserved query capacity. Commit checked retrieval/answer changes in small coherent increments. Retain lasting staging-isolation, snapshot, citation and read-only-access tests; keep maintained quality evaluations outside release images.

Use `pro6000/qwen38-flash-next` through the environment-configured OpenAI-compatible gateway for development answers. The bounded Chat Completions tool loop is implemented with the pinned SDK. The UI polls durable run progress; token streaming is not required for this version. Semantic quality is evaluated separately from citation and scope validity.

## Summary-first retrieval direction (2026-10-07)

Start with continuing project/topic or source summaries, then open relevant segment summaries and the exact transcript/page/slide evidence only as needed. Search must include underlying admitted text so omitted summary details remain discoverable. Shared segment identities connect topic and source views without duplicating evidence. Pin one memory snapshot for the entire research run, and follow the exact child-version references from each overview; newer pushes must not change earlier reads.

Available read-only application endpoints are `/api/memory/organized`, `/api/memory/organized/search?q=...&projectId=...&knownVersion=...`, and `/api/memory/nodes/:id?knownVersion=...&versionId=...`. The node response exposes pinned children, summary history and original evidence for a segment. Researcher loads one frozen corpus from these application services, with application-selected snapshot/project/date scope. Model arguments cannot widen it. Typed assertion/entity tools may supplement this later; summary-first source evidence is the implemented entry point.

Summaries guide discovery. Answer citations must point to exact admitted source evidence rather than citing generated overview prose as independent support. Keep disagreements/unknown dates visible, and distinguish source-reported results from the Researcher's inference. Independent questions, saved cited answers, and a maintained corpus evaluation are implemented. Historical summary snapshots are supported; legacy typed-only snapshots before summary organization remain in the assertion comparison viewer and do not yet have a Researcher fallback adapter. Multi-turn conversation context is not an evidence source.

## Query contract and scope

Input: question, optional conversation context/project/time scope, and an application-supplied memory snapshot. Default snapshot is the latest committed memory revision when the run starts. Historical questions can specify both `effectiveAt` and `knownAt`; otherwise make the interpretation explicit.

All tool results, current-state projections, vector/lexical indexes, source resolutions, and caches must obey this scope. A concurrent push must not change the evidence universe midway through an answer. If an index lags, use authoritative structured/lexical data or report incomplete search; do not claim completeness from stale results.

Unpushed staging is excluded even though its records share the database. New unpushed revisions of an incorporated source are also excluded. Source access resolves IDs and admitted lineage, never arbitrary paths or the latest staging pointer.

## Tools

```text
searchMemory(query, limit)
openNode(nodeId, offset, versionId?)
openSegment(nodeId, offset, versionId?)
inspectImage(citationId)
getHistory(nodeId)
getChanges(fromVersion, toVersion)
listSources(offset)
approvedState(offset)
approvedHistory(itemId, offset)
```

The frozen scope also records a review-history version. `approvedState` and `approvedHistory` read reviewer-approved decisions and commitments from **What changed?** at that version; current questions capture the latest approvals, and historical questions respect the requested known-time or memory-version cutoff. Unapproved or rejected proposals are unavailable. Claims citing approved state use `basis: reviewed` with `reviewRefs`; the answer's `reviewReferences` link each to its approving event, original evidence and reviewer-added fields. Meeting reports remain separate `source` claims. Saved answers from earlier prompt versions are unchanged.

Snapshot/project/known-time access constraints are injected by application context and cannot be widened by model arguments. Validate requested IDs and bounds against completed push membership.

Use project/topic/source relationships for structured navigation, exact child-version pins for history, and lexical ranking for discovery. Two channels rank summaries/title/keywords and full original text, using IDF-weighted matching and reciprocal rank fusion. Traditional/Simplified Chinese query normalization and Han bigrams support transcripts without whitespace. The configured model gateway's embeddings endpoint returned 404, so pgvector indexing is deferred rather than silently substituting an untested embedding service. The existing database extension remains available for a future measured adapter. Tool outputs disclose incomplete/paginated coverage.

For visual evidence, search source-linked text/metadata/annotations and then load actual frame/slide/page primitives. A text embedding model does not itself provide image embeddings. Fetch readable regions for numeric/diagram claims; abstain if evidence is unreadable.

Implemented limits: 20 search candidates, 20 child overviews per page, five original text chunks per read, 42,000 original text characters, six images / 12 MB image bytes, 24 tool calls, ten retrieval rounds and a 12-minute run deadline. Overview snippets are capped at 900 characters. A 100,000-character context threshold requests a final limited answer, rather than failing from navigation growth. These are tuning values. Structured enumerations must paginate or disclose truncation. Test lexical segmentation on actual corpus languages.

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


## Saved runs and operations

`POST /api/research` accepts `question`, `idempotencyKey`, optional `projectId`, `knownVersion` or `knownAt`, and `effectiveAt` (date). The application captures the actual snapshot at creation, before queuing. `GET /api/research/:id` returns saved progress/answer; POST with `action: retry` or `cancel` controls that run. Retry preserves the original question/scope and increments a durable delivery generation. This prevents canceled-before-claim jobs from stranding a retry behind an already completed queue ID. Session locks serialize duplicate deliveries and release after a process exit. Attempt-conditional updates prevent canceled/replaced work from publishing an answer.

Consecutive speech turns form readable spans (up to 60 utterances / roughly 2,400 characters), preserving the original per-utterance text offsets, speaker labels and start/end times. Five spans per read give the model meaningful context; document chunks retain their original primitive ranges. Citation viewers reconstruct the exact saved span from the admitted revision.

Original evidence gets short run-local citation labels (`E1`, `E2`, ...). Stored citations retain the full revision ID, primitive ID, node/version IDs, exact text range or image locator, historical flag and snapshot-bound URL. The model may cite only evidence actually read; listing an image alone does not count as visual inspection. Invalid answer JSON/citations receive bounded repair with an explicit inspected-evidence inventory. Invalid final answers are withheld. After two discovery calls with segment candidates, the next tool selection is restricted to original segment reading so repeated summary searches cannot consume the entire context before source inspection. Requested files absent from the complete scoped catalog are reported as unavailable, without substituting similar files. Failed runs retain bounded tool traces, usage and model/prompt provenance for diagnosis.

A source containing multiple project discussions exposes only authorized segment children and masks aggregate source prose/keywords when project scoped. Date-filtered queries also mask aggregate prose and exclude unknown/future source dates. Direct node/history/image calls obey the same frozen scope as search. The Researcher never follows the current staging revision pointer.

Run `./infra/test.sh integration` against disposable database/storage for the durable queue/SDK/history/cancellation/isolation checks; unit checks live in `research.test.ts`, browser workflow in `research.spec.ts`, and real questions in `evals/researcher/questions.json`. The release image excludes tests, tools, evaluation data and reports.
