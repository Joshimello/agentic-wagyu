# Maintained real-corpus evaluations

These datasets and runners are development tools outside production images. Private recordings/documents, generated reports and model credentials stay out of Git. Evaluation results are observations; same-model correctness/support scores do not establish independent human accuracy or recall.

`infra/evaluate.sh` builds the frozen Bun check image and runs a selected command on a running workspace. Set `CHRONICLER_PROJECT` and `CHRONICLER_DATA_MOUNT` for a separate workspace; defaults are the local main workspace and its `data/` directory.

```sh
./infra/evaluate.sh interpreter:video
./infra/evaluate.sh interpreter:documents
./infra/evaluate.sh memory:integrity
./infra/evaluate.sh researcher --repeat=3 --concurrency=3 --tag=review
```

The Interpreter checks inspect existing ready revisions without changing their evidence and verify source mapping/export fidelity against `meetings.json` and `documents.json`. Memory integrity verifies every legacy historical citation/quotation and project relation. Researcher checks fixed-snapshot answers, structural citations and coarse source-group discovery, saving bounded traces, usage and model/prompt/implementation provenance in ignored `data/evaluations/researcher`. Answer-agent token totals exclude judge calls. Use a new tag after changing code, prompts, model, questions or snapshot. `--mode=retrieval` omits generation; `--ids=p01,m01` selects questions.

For reproducible corpus setup, `./infra/evaluate.sh import:recordings` and `import:documents` hash-check original inputs and submit missing files through the ordinary staging service. These commands **write staging**. `./infra/evaluate.sh organization` **writes accepted memory** by sequentially pushing the six pinned weekly sources with partial-coverage disclosure. Run it deliberately in a separate reviewed workspace. It checks cross-week continuity, independent-project separation, complete original text coverage, child-version history and unpushed controls. Legacy assertion behavior is retained in durable integration tests and the read-only integrity tool; its one-off weekly replay script was removed.

The [lifecycle dataset](lifecycle/README.md) was held out from memory admission, though its documents had been used in Interpreter development. Its original baseline and follow-up have different exposure status. `infra/verify-workflow.sh --evaluate` exercises the real workflow before three repetitions of these questions. Independent semantic review remains pending.

Historical experiment findings, including the retired Docling comparison and earlier milestone commands, remain in [acceptance history](../docs/development/acceptance.md). Their one-off runners/environments are no longer contributor dependencies. Generated test reports stay out of the active working tree; maintained evaluation observations can be preserved privately outside release images.
