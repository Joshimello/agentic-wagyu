# Lifecycle source-holdout evaluation

`questions.json` contains ten questions frozen before the M7 live pilot: eight answerable questions about two documents and two absent-evidence cases. The documents are the supplied subcontract PPTX and midterm PDF. They were used during Interpreter development, but were not admitted to Chronicler/Researcher memory before this isolated pilot. Do not describe this as a completely unseen corpus.

Each `gold` entry matches an entire source (`title: ".*"`). Initial coverage at ten is a coarse source-group discovery proxy, not passage-level relevance, precision or exhaustive evidence recall. Semantic correctness and factual support are judged by the same model used for answers. Human scoring remains pending. Repeated runs measure observed variability rather than independent semantic ground truth.

## Running

With the supplied files in ignored `data/recordings` and `data/documents`, use a new workspace name and free port:

```sh
CHRONICLER_PROJECT=chronicler_pilot_example CHRONICLER_PORT=5174 ./infra/verify-mvp.sh --evaluate
```

The script runs all application work in Podman, creates fresh database/evidence volumes, uploads a real five-minute meeting excerpt plus the July deck, exercises review/push/question/correction/history, admits the two documents, and runs these ten questions three times. It preserves the pilot and private reports for inspection. It does not modify main accepted memory. Gateway credentials stay in ignored `.env`.

The maintained evaluator accepts `--manifest=/app/evals/lifecycle/questions.json` inside its Podman runner, with the isolated database URL and evidence volume. Use a new `--tag` after changing the implementation, model, prompt, question definitions or snapshot. Standalone answer-agent token summaries exclude judge requests; do not interpret them as total API usage. See [operations](../../docs/operations.md) for recovery and [the pilot report](../../docs/development/lifecycle-pilot.md) for measured acceptance evidence.

## Recorded result and limits

The original `researcher-5-en` run completed 30/30 answers with valid citations and 155/155 claims accepted by the same-model judge. Initial source-group coverage was 87.5%, below the proposed 90% target; later traversal recovered the missing PDF and final coverage was 100%.

The exact-filename ranking fix in `researcher-6-en` was followed by 30/30 completed answers, valid citations, 149/149 claims accepted by the same-model judge and 100% initial coverage. These are the same exposed questions. This second run is a regression check, not a fresh blind holdout; the JSON `holdout` flags identify the original source-admission split and do not reset that exposure. Preserve both results.

Before claiming human semantic acceptance, annotate original excerpts and score correctness, support, omissions and project separation independently. To measure blind generalization after the fix, freeze new questions before running the updated implementation. Neither the successful follow-up nor repeated same-model judgments establish the proposed human accuracy/recall thresholds.
