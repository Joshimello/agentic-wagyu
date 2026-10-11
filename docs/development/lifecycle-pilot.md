# Full lifecycle and recovery pilot

Recorded 2026-10-11. M7 implementation and automated functional/recovery acceptance are complete. Independent human semantic acceptance remains pending. Run commands and operational limitations are maintained in [the operations guide](../operations.md); the frozen question definitions are in [the lifecycle evaluation](../../evals/lifecycle/README.md).

## Workspace and inputs

The main workspace retained accepted snapshot 13 and its original evidence. All new admissions took place in fresh Podman volumes for `chronicler_pilot_m7_final`, available at <http://localhost:5176>. Main development remains at <http://localhost:5173>. Restore workspaces were stopped after verification, preserving their volumes.

The pilot used original supplied material, with no synthetic replacement content:

| Input | Coverage |
| --- | --- |
| `2026-09-08.mp4`, 10:00–15:00 excerpt | 300 seconds, 54 timestamped speech segments |
| `260720_VLM.pptx` | All 36 slides |
| `115年度資通所分包_基於VLM的目標選取與語意標註_清大_朱宏國.pptx` | All 28 slides |
| `ITRI_VLM_Midterm_Report.pdf` | All 13 pages |

The last two documents had been used during Interpreter development but had not previously been admitted to memory. Their source dates remain unknown rather than inferred from filenames. All four interpretations completed with visible coverage warnings retained for review. This pilot does not establish full-recording transcription or diarization accuracy.

## Functional and recovery result

The live runner passed 114 checks in 715.909 seconds (11 minutes 55.909 seconds). It exercised upload, staging inspection, explicit pinned push, saved question, original-source citations, transcript punctuation correction, unchanged accepted memory before repush, a new accepted revision, historical drilldown, frozen earlier answers and unchanged-repush deduplication. A deliberate worker interruption occurred while the first push was processing. Recovery produced one publication at each commit version, with no duplicate interpretation revision.

The final pilot has three memory commits, two projects, 19 topics, four current sources and 43 current segments. There are five historical evidence admissions because the corrected meeting revision supersedes its original admission without deleting it. Project and topic quality remain subject to human review.

A separate staging edit on the restored full main workspace compared all ten accepted memory tables before and after. Their SHA-256 fingerprint remained `7bfd5ce2df77073c79289edbcbf9c17a759def2c34042408bfa86d57441bdb46`. This includes both the earlier typed memory and summary graph. The maintained runner additionally checks the original upload byte hashes and fingerprints the summary-node tables; the separate full-workspace check supplies the broader accepted-table isolation proof.

Durable operation regressions passed cancellation before delivery, cancellation during reconciliation, retry with exact pins, fresh queue delivery, a real child-process SIGKILL followed by lease recovery, one-time publication, concurrent model reservations and conservative accounting of unknown outcomes. Recovery requeues records only when their session lease is absent. Failed terminal work stays manually retryable. Memory publication and its searchable SQL state share a transaction, so there is no separate mutable index to catch up after publication.

## Backup and fresh-volume restore

Both backups stopped application writers, preserved their previous running state afterward, and verified database inventories and every archived asset hash after restoration into new Podman volumes.

| Backup | Bytes | Assets | Memory commits | Restore checks |
| --- | ---: | ---: | ---: | ---: |
| Main workspace | 920,017,685 | 1,130 | 13 | 2,171 |
| Final pilot | 199,513,379 | 193 | 3 | 320 |

The main restore resolved all 769 legacy citations, 163 organization node versions, 13 saved answers and their 53 citations. The pilot restore resolved 86 organization node versions, two saved answers and their 27 citations. Both inspection-only restores rejected mutations and displayed their mode. The main restore was then resumed writable and answered a saved question again in 12.919 seconds with six model calls, while memory remained unchanged; that verification reported 2,191 checks overall. The original saved answers stayed frozen.

Private backup locations are `data/backups/lifecycle-original-20261011` and `data/backups/lifecycle-pilot-20261011`. These are research data, excluded from Git and release images. Checksums detect corruption but do not authenticate an untrusted backup. Restore refuses existing target volumes.

## Live quality observations

Ten questions were frozen before the live run: eight answerable questions about the two newly admitted documents and two questions about absent production evidence. Each was run three times against fixed snapshot 3. Whole-source relevance groups are a coarse discovery measure, not annotated passage-level evidence recall. The same self-hosted Qwen model answered and judged the answers.

| Observation | Initial source-holdout run | Follow-up regression |
| --- | ---: | ---: |
| Researcher version | `researcher-5-en` | `researcher-6-en` |
| Completed answers | 30/30 | 30/30 |
| Structurally valid citation references | 606/606 | 585/585 |
| Same-model correctness judgments | 30/30 | 30/30 |
| Same-model supported claims | 155/155 | 149/149 |
| Initial source-group coverage at 10 | 87.5% in each repetition | 100% in each repetition |
| Final source-group coverage | 100% | 100% |
| Critical failures | 0 | 0 |
| Median answer-agent seconds | 32.524 | 39.003 |
| Maximum answer-agent seconds | 89.839 | 76.880 |
| Per-repetition median seconds | 41.100 / 32.524 / 30.937 | 40.600 / 36.281 / 39.003 |
| Answer-agent input tokens | 5,407,631 | 5,468,679 |
| Answer-agent output tokens | 62,651 | 58,539 |

The initial run missed the proposed 90% initial discovery target: the explicitly named midterm PDF did not appear in the initial ten results for question `l01`, although subsequent catalog traversal found it and final answers cited it. This exposed a general ranking defect. Researcher now prioritizes an exact filename within its already eligible accepted scope, with regressions for filename boundaries and project isolation. It cannot discover unpushed files through this priority. The follow-up reused the exposed questions and is a diagnostic regression, not a new blind holdout. Both full runs left memory unchanged.

An additional five-question M6 regression on main snapshot 13 covered source discovery, transcripts, absent evidence, visual evidence and history: five completed answers, valid citations and all automated correctness/support proxies passed, with unchanged memory. Median latency was 22.194 seconds and maximum 32.233 seconds; answer-agent usage was 316,041 input and 4,163 output tokens.

The full runs overlapped with other gateway activity. They are observations under shared load, not a controlled speed comparison or an SLA. Evaluation token totals cover answer agents and exclude judging/repair requests. The original baseline and follow-up reports are both retained; the successful follow-up does not erase the initial discovery miss.

Human scoring is still required for correctness, claim-to-excerpt alignment, omissions, project separation and evidence recall. The corpus is not completely unseen, the source groups are developer-authored, and repeated same-model judgments are not independent human labels. A new frozen, unexposed question set is needed to measure blind generalization after the ranking fix. No new WER/DER ground truth was supplied.

## Performance and usage on this machine

Hardware: NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition, 97,887 MiB reported VRAM. The local media service used pinned `OpenMOSS-Team/MOSS-Transcribe-Diarize` revision `704aa4a9c304e8520be88901e0d1960158ef5b15`. The uncached five-minute inference took 13.209 seconds, generated 1,697 tokens, and reported 2.330 GiB framework peak allocation. This is model inference time/allocation, not whole-pipeline time or total device memory. Its output was neither truncated nor marked incomplete.

| Operation | Enqueue-to-completion seconds |
| --- | ---: |
| Meeting excerpt interpretation | 92.865 |
| July PPTX interpretation | 35.205 |
| Subcontract PPTX interpretation | 32.063 |
| Midterm PDF interpretation | 11.653 |
| Initial video + PPTX push | 243.568 |
| Corrected meeting push | 34.985 |
| Two held-out document push | 224.821 |

The initial push includes the deliberate interruption and worker replacement and completed on attempt two. The other pushes completed on attempt one. All used `organization-3-en`; structured partition validation still rejects invalid source ranges rather than silently accepting them. The pilot exposed printed slide/page numbers being confused with internal unit indexes. Explicit unit-index instructions and actionable validation feedback now preserve the source-unit contract.

Production worker accounting recorded 150 HTTP attempts: 149 with provider usage and one unknown interrupted outcome. Measured usage was 1,040,821 input and 81,869 output tokens. The unknown request retained reservations of 27,743 input and 10,000 output tokens, producing conservatively charged totals of 1,068,564 input and 91,869 output. Interpreter made 48 calls, Researcher 22 and Chronicler 80. These production totals are separate from standalone evaluation totals above.

The default operation limits are 300 HTTP attempts, 2,000,000 input tokens and 200,000 output tokens; daily limits are disabled unless configured. Concurrent reservations enforce those limits before dispatch, including SDK retries. Input reservations are an estimate; missing provider usage remains conservatively charged. The ledger stores hashes, usage and provenance, not request text, images or secrets. API prices were not configured, so monetary cost is unknown. Electricity and hardware cost were not measured.

## Build and regression evidence

All checks ran inside Podman with Bun and frozen installs. The standard suite passed 89 tests with 434 assertions; 44 corpus/integration-dependent tests were skipped there and relevant integration suites ran separately. Operations passed 6 tests/33 assertions; memory 12/66; organization 7/53; research 7/40; translation 6/25; migration histories 3/25. Backup corruption/inventory cases and exact-filename ranking regressions are included in the standard suite. Browser checks passed 25 cases. Svelte check reported zero errors and warnings. Development and release image builds passed.

Private raw reports are under `data/evaluations/lifecycle/chronicler_pilot_m7_final/reports/`, and other check logs are under ignored `data/`. Production images exclude test runners, evaluations, reports, credentials and source evidence. M8 remains the separate cleanup/release milestone; this work retains lasting operation, history, citation and isolation coverage.
