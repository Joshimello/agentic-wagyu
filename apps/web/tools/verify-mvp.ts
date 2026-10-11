import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sqlClient } from '../src/lib/server/db/client';
import { memorySnapshot } from '../src/lib/server/services/memory';
import { type Stage } from '../src/lib/server/contracts';
const base = process.env.APP_URL ?? 'http://web:5173';
const corpus = process.env.PILOT_CORPUS_ROOT ?? '/corpus';
const reportRoot = process.env.PILOT_REPORT_ROOT ?? '/reports';
const stateFile = join(reportRoot, 'lifecycle.json');
let report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  base,
  checks: [],
  timings: [],
  uploads: [],
  answers: [],
};
if (process.argv.includes('--resume')) {
  report = await Bun.file(stateFile).json();
  report.resumedAt = new Date().toISOString();
  delete report.error;
  delete report.passed;
}
const started = Date.parse(report.startedAt);
await mkdir(reportRoot, { recursive: true });
async function save() {
  await Bun.write(stateFile, JSON.stringify(report, null, 2));
}
async function memoryFingerprint() {
  const snapshot = await memorySnapshot();
  const nodes = await sqlClient`select * from memory_nodes order by id`;
  const versions =
    await sqlClient`select * from memory_node_versions order by id`;
  return JSON.stringify({ snapshot, nodes, versions });
}
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  report.checks.push(label);
}
async function api(path: string, body?: unknown) {
  const response = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
async function wait(
  path: string,
  value: (data: any) => any,
  done: string[],
  label: string,
) {
  const begin = Date.now();
  let failedSince = 0;
  let last = '',
    nextLog = 0;
  while (Date.now() - begin < 60 * 60 * 1000) {
    const result = await api(path),
      state = value(result);
    if (done.includes(state.state)) {
      report.timings.push({ label, elapsedMs: Date.now() - begin });
      await save();
      return result;
    }
    if (state.state === 'failed') failedSince ||= Date.now();
    else failedSince = 0;
    if (
      state.state === 'canceled' ||
      (failedSince && Date.now() - failedSince > 30000)
    )
      throw new Error(`${label}: ${state.state}; inspect retained workspace`);
    if (state.progress !== last || Date.now() >= nextLog) {
      console.log(
        JSON.stringify({
          label,
          state: state.state,
          progress: state.progress,
          elapsedSeconds: Math.round((Date.now() - begin) / 1000),
        }),
      );
      last = state.progress;
      nextLog = Date.now() + 30000;
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${label}: pilot deadline exceeded`);
}
async function upload(
  path: string,
  filename: string,
  sourceTime: string | null,
) {
  const file = Bun.file(join(corpus, path));
  assert(await file.exists(), `Real fixture exists: ${filename}`);
  let accepted = report.uploads.find((u: any) => u.filename === filename);
  if (!accepted) {
    const form = new FormData();
    form.append('file', new File([await file.arrayBuffer()], filename));
    form.append('uploader', 'local');
    if (sourceTime) form.append('sourceTime', sourceTime);
    form.append('label', filename);
    const response = await fetch(base + '/api/uploads', {
      method: 'POST',
      body: form,
      headers: { Origin: process.env.APP_ORIGIN ?? new URL(base).origin },
    });
    assert(response.status === 202, `Upload accepted: ${filename}`);
    accepted = await response.json();
    report.uploads.push({ filename, ...accepted });
    await save();
  }
  const detail = await wait(
    `/api/uploads/${accepted.uploadId}`,
    (r) => r.run,
    ['ready', 'ready_with_warnings'],
    `interpret ${filename}`,
  );
  assert(
    detail.revisions.filter((r: any) => r.runId === accepted.runId).length ===
      1,
    `One published revision: ${filename}`,
  );
  const stage = detail.revisions.find((r: any) => r.runId === accepted.runId)
    .manifest as Stage;
  assert(
    stage.primitives.length > 0,
    `Extracted inspectable evidence: ${filename}`,
  );
  assert(
    detail.asset.sha256 ===
      new Bun.CryptoHasher('sha256')
        .update(await file.arrayBuffer())
        .digest('hex'),
    `Original bytes preserved: ${filename}`,
  );
  const raw = await fetch(base + `/api/assets/${stage.rawAssetId}`);
  assert(raw.ok, `Original download resolves: ${filename}`);
  await raw.body?.cancel();
  assert(
    (await fetch(base + `/staging/${stage.uploadId}?revision=${stage.id}`)).ok,
    `Staging review resolves: ${filename}`,
  );
  return stage;
}
async function push(stages: Stage[], label: string) {
  const input = {
    idempotencyKey: crypto.randomUUID(),
    items: stages.map((s) => ({
      uploadId: s.uploadId,
      revisionId: s.id,
      acceptPartial: !s.coverage.complete,
    })),
  };
  const created = await api('/api/pushes', input),
    replay = await api('/api/pushes', input);
  assert(created.id === replay.id, `${label}: idempotent push creation`);
  const done = await wait(
    `/api/pushes/${created.id}`,
    (r) => r,
    ['committed'],
    label,
  );
  report.pushes ??= [];
  report.pushes.push(done);
  await save();
  return done;
}
async function ask(question: string, knownVersion?: number) {
  const existing = report.answers.find(
    (r: any) => r.input.question === question,
  );
  if (existing) return existing;
  const run = await api('/api/research', {
    question,
    idempotencyKey: crypto.randomUUID(),
    ...(knownVersion === undefined ? {} : { knownVersion }),
  });
  const done = await wait(
    `/api/research/${run.id}`,
    (r) => r,
    ['completed'],
    `ask ${report.answers.length + 1}`,
  );
  assert(
    done.answer?.citations.length > 0,
    'Answer contains inspected original evidence',
  );
  for (const citation of done.answer.citations) {
    const response = await fetch(base + citation.url);
    assert(response.ok, `Pinned citation resolves: ${citation.id}`);
    await response.body?.cancel();
    const [revision] =
      await sqlClient`select manifest from staging_revisions where id=${citation.revisionId}`;
    assert(
      revision?.manifest.primitives.some(
        (p: any) => p.id === citation.primitiveId,
      ),
      `Citation primitive exists: ${citation.id}`,
    );
  }
  assert(
    (await fetch(base + `/ask/${run.id}`)).ok,
    'Saved answer page resolves',
  );
  report.answers.push(done);
  await save();
  return done;
}
try {
  const original = await memorySnapshot();
  if (!process.argv.includes('--resume'))
    assert(original.version === 0, 'Pilot starts with empty isolated memory');
  const video = await upload(
    'meeting-excerpt.mp4',
    '2026-09-08-excerpt.mp4',
    '2026-09-08T00:00:00.000Z',
  );
  assert(
    video.primitives.some((p) => p.kind === 'text' && p.role === 'asr'),
    'Real meeting produces timestamped speech',
  );
  const deck = await upload(
    '260720_VLM.pptx',
    '260720_VLM.pptx',
    '2026-07-20T00:00:00.000Z',
  );
  assert(
    Boolean(deck.document?.review),
    'Real deck has slide labels and a document summary',
  );
  if (!report.checks.includes('Interpreted files remain outside memory'))
    assert(
      (await memorySnapshot()).version === 0,
      'Interpreted files remain outside memory',
    );
  const first = await push([video, deck], 'initial video and deck push');
  const initialAnswer = await ask(
    'What VLM research progress and outstanding issues are described in the July 20 presentation? Cite original slides.',
  );
  const beforeHash = await memoryFingerprint();
  const primitive = video.primitives.find(
    (p) => p.kind === 'text' && p.role === 'asr',
  );
  if (!primitive || primitive.kind !== 'text')
    throw new Error('No speech to review');
  const corrected =
    report.corrected ??
    ((await api(`/api/uploads/${video.uploadId}/corrections`, {
      baseRevisionId: video.id,
      label: video.metadata.label,
      sourceTime: video.metadata.sourceTime,
      edits: [
        {
          primitiveId: primitive.id,
          text:
            primitive.text.trimEnd() +
            (primitive.text.endsWith('。') ? '' : '。'),
          speaker: primitive.speaker,
        },
      ],
    })) as Stage);
  report.corrected = corrected;
  await save();
  assert(
    corrected.id !== video.id,
    'Correction creates a new immutable staging revision',
  );
  assert(
    (await memoryFingerprint()) === beforeHash,
    'Staging correction leaves accepted memory exactly unchanged',
  );
  const second = await push([corrected], 'reviewed meeting repush');
  assert(
    second.commitVersion > first.commitVersion,
    'Repush appends memory history',
  );
  const historical = await api(
    `/api/memory/organized?knownVersion=${first.commitVersion}`,
  );
  assert(
    historical.sources.some((s: any) => s.revisionId === video.id),
    'Historical graph retains original meeting revision',
  );
  const current = await api('/api/memory/organized');
  assert(
    current.sources.some((s: any) => s.revisionId === corrected.id),
    'Current graph selects corrected meeting revision',
  );
  assert(
    !current.sources.some((s: any) => s.revisionId === video.id),
    'Superseded revision is absent from current source graph',
  );
  const saved = await api(`/api/research/${initialAnswer.id}`);
  assert(
    JSON.stringify(saved.answer) === JSON.stringify(initialAnswer.answer),
    'Previously saved answer stays frozen after repush',
  );
  for (const citation of saved.answer.citations) {
    const response = await fetch(base + citation.url);
    assert(response.ok, 'Old answer citation remains resolvable');
    await response.body?.cancel();
  }
  await ask(
    'Summarize the meeting excerpt and distinguish its evidence from the July presentation. Cite the original sources.',
  );
  const unchanged = await api('/api/pushes', {
    idempotencyKey: crypto.randomUUID(),
    items: [
      {
        uploadId: corrected.uploadId,
        revisionId: corrected.id,
        acceptPartial: !corrected.coverage.complete,
      },
    ],
  });
  assert(
    unchanged.id === second.id,
    'Unchanged repush reuses the accepted batch',
  );
  const [duplicates] =
    await sqlClient`select count(*)::int as count from (select run_id from staging_revisions where run_id is not null group by run_id having count(*)>1) r`;
  assert(duplicates.count === 0, 'No duplicate interpretation publication');
  if (process.argv.includes('--heldout')) {
    const beforeHoldout = (await memorySnapshot()).version;
    const extra = await upload(
      '115年度資通所分包_基於VLM的目標選取與語意標註_清大_朱宏國.pptx',
      '115年度資通所分包_基於VLM的目標選取與語意標註_清大_朱宏國.pptx',
      null,
    );
    const midterm = await upload(
      'ITRI_VLM_Midterm_Report.pdf',
      'ITRI_VLM_Midterm_Report.pdf',
      null,
    );
    assert(
      (await memorySnapshot()).version === beforeHoldout,
      'Held-out documents remain staged until pushed',
    );
    report.holdout = await push([extra, midterm], 'held-out document push');
  }
  const [usage] =
    await sqlClient`select count(*)::int as calls, sum(coalesce(input_tokens,estimated_input))::float8 as input, sum(coalesce(output_tokens,reserved_output))::float8 as output, count(*) filter(where state='measured')::int as measured from model_requests`;
  report.usage = usage;
  report.finalVersion = (await memorySnapshot()).version;
  report.passed = true;
  report.elapsedMs = Date.now() - started;
  await save();
  console.log(
    JSON.stringify({
      passed: true,
      checks: report.checks.length,
      elapsedMs: report.elapsedMs,
      usage,
      report: stateFile,
    }),
  );
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : 'Pilot failed';
  report.elapsedMs = Date.now() - started;
  await save();
  throw error;
} finally {
  await sqlClient.end();
}
