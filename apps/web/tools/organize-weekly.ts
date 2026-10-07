/** Explicit, resumable operator evaluation using the user's actual staged sources. No generated live fixtures. */
import corpus from '../../../evals/weekly-progress.json';
const base = process.env.WEB_URL ?? 'http://web:5173';
const report: {
  filename: string;
  family: string;
  uploadId: string;
  revisionId: string;
  pushId: string;
  memoryVersion: number;
  projects: number;
  segments: number;
  elapsedMs: number;
  acceptPartial: boolean;
  outcomes: unknown;
  organizationMode: 'full' | 'scope';
}[] = [];
async function request(path: string, options?: RequestInit) {
  // The web app may be replaced while the durable worker continues processing.
  // Writes here carry the same idempotency key, so reconnects cannot duplicate a push.
  for (let attempt = 0; attempt < 15; attempt++) {
    let response: Response;
    try {
      response = await fetch(base + path, options);
    } catch (error) {
      if (attempt === 14) throw error;
      await Bun.sleep(2000);
      continue;
    }
    if ([502, 503, 504].includes(response.status) && attempt < 14) {
      await Bun.sleep(2000);
      continue;
    }
    const value = await response.json();
    if (!response.ok)
      throw new Error(`${path}: ${value.error ?? response.status}`);
    return value;
  }
  throw new Error('Application reconnect timed out');
}
const staged = new Map<string, any>();
const uploads = await request('/api/uploads');
for (const source of corpus.sources) {
  const upload = uploads.find((u: any) => u.filename === source.filename);
  if (!upload) throw new Error(`Missing source ${source.filename}`);
  const detail = await request(`/api/uploads/${upload.id}`);
  const stage = detail.revisions.find(
    (r: any) => r.id === detail.upload.currentRevisionId,
  ).manifest;
  staged.set(stage.id, stage);
  const before = await request('/api/memory/organized');
  const assigned = new Set(
    before.topics.flatMap((t: any) => t.children.map((c: any) => c.nodeId)),
  );
  const organizationMode = before.segments.some(
    (n: any) =>
      n.revisionId === stage.id &&
      !n.current.segment.contextOnly &&
      !assigned.has(n.id),
  )
    ? 'scope'
    : 'full';
  const batch = await request('/api/pushes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflow: 'summary',
      organizationMode,
      idempotencyKey: `organized-weekly:${stage.id}:organization-2-en:${organizationMode}`,
      items: [
        {
          uploadId: upload.id,
          revisionId: stage.id,
          acceptPartial: !stage.coverage.complete,
        },
      ],
      projectScope: { mode: 'auto' },
    }),
  });
  console.log(
    JSON.stringify({
      event: 'push_started',
      filename: source.filename,
      pushId: batch.id,
      acceptPartial: !stage.coverage.complete,
    }),
  );
  let current = batch;
  for (
    let attempt = 0;
    attempt < 600 && current.state !== 'committed';
    attempt++
  ) {
    if (current.state === 'failed') {
      // pg-boss retries transient work after five seconds; allow that dispatch to settle.
      // A persistent failure still stops evaluation and needs an explicit pinned retry.
      for (
        let settle = 0;
        settle < 15 && current.state === 'failed';
        settle++
      ) {
        await Bun.sleep(2000);
        current = await request(`/api/pushes/${batch.id}`);
      }
    }
    if (current.state === 'failed' || current.state === 'canceled')
      throw new Error(
        `${source.filename}: ${current.error ?? current.state} (push ${current.id})`,
      );
    await Bun.sleep(2000);
    current = await request(`/api/pushes/${batch.id}`);
    if (attempt % 15 === 0)
      console.log(
        JSON.stringify({
          filename: source.filename,
          state: current.state,
          progress: current.progress,
        }),
      );
  }
  if (current.state !== 'committed')
    throw new Error('Timed out waiting for weekly push');
  const memory = await request(
    `/api/memory/organized?knownVersion=${current.commitVersion}`,
  );
  report.push({
    filename: source.filename,
    family: source.family,
    uploadId: upload.id,
    revisionId: stage.id,
    pushId: batch.id,
    memoryVersion: current.commitVersion,
    projects: memory.projects.length,
    segments: memory.segments.length,
    // Durable timing survives an interrupted evaluation or unchanged replay.
    elapsedMs: Date.parse(current.updatedAt) - Date.parse(current.createdAt),
    acceptPartial: !stage.coverage.complete,
    outcomes: current.outcomes,
    organizationMode,
  });
  await Bun.write(
    '/data/evaluations/organized-weekly.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ event: 'push_committed', ...report.at(-1) }));
}
const memory = await request('/api/memory/organized');
const bySource = new Map<string, Set<string>>();
for (const source of report) {
  const projects = new Set<string>();
  const leaves = new Set(
    memory.segments
      .filter((n: any) => n.revisionId === source.revisionId)
      .map((n: any) => n.id),
  );
  for (const project of memory.projects) {
    const topics = memory.topics.filter((t: any) => t.scopeId === project.id);
    if (
      topics.some((t: any) => t.children.some((c: any) => leaves.has(c.nodeId)))
    )
      projects.add(project.id);
  }
  bySource.set(source.filename, projects);
}
for (const family of [...new Set(report.map((r) => r.family))]) {
  const weeklyProjects = report
    .filter((r) => r.family === family)
    .map((r) => bySource.get(r.filename)!);
  if (
    ![...weeklyProjects[0]].some((id) =>
      weeklyProjects.every((ids) => ids.has(id)),
    )
  )
    throw new Error(`No cross-week project continuity for ${family}`);
}
const vlm = new Set(
  report
    .filter((r) => r.family === 'vlm_uav')
    .flatMap((r) => [...bySource.get(r.filename)!]),
);
const scenes = new Set(
  report
    .filter((r) => r.family === 'scene_reconstruction')
    .flatMap((r) => [...bySource.get(r.filename)!]),
);
if (
  ![...vlm].some((p) => !scenes.has(p)) ||
  ![...scenes].some((p) => !vlm.has(p))
)
  throw new Error('Different research efforts did not remain distinct');
for (const filename of corpus.unpushedControls) {
  const upload = uploads.find((u: any) => u.filename === filename);
  const detail = await request(`/api/uploads/${upload.id}`);
  if (detail.memory.state !== 'never_pushed')
    throw new Error(`Control was unexpectedly pushed: ${filename}`);
  for (const revision of detail.revisions)
    if (memory.nodes.some((n: any) => n.revisionId === revision.id))
      throw new Error('Unpushed evidence entered memory');
}
// Independent completeness check: concatenate exact text from segment drilldowns,
// and compare it with pinned source primitives in their original document/turn order.
const versions = new Map(
  memory.nodes.flatMap((n: any) =>
    n.history.map((v: any) => [v.id, { node: n.id, version: v.commitVersion }]),
  ),
);
for (const n of memory.nodes)
  for (const v of n.history)
    for (const c of v.children) {
      const child: any = versions.get(c.versionId);
      if (!child || child.node !== c.nodeId || child.version > v.commitVersion)
        throw new Error('Broken historical child pin');
    }
let exactCharacters = 0;
for (const source of memory.sources) {
  const stage = staged.get(source.revisionId);
  if (!stage) throw new Error('Unexpected organized source');
  const nativeIds = stage.document
    ? stage.document.units.flatMap((u: any) => u.textIds)
    : stage.primitives
        .filter((p: any) => p.kind === 'text')
        .map((p: any) => p.id);
  const expected = nativeIds
    .map((id: string) => stage.primitives.find((p: any) => p.id === id).text)
    .join('');
  let actual = '';
  let cursor = 0;
  for (const child of source.children) {
    const leaf = await request(
      `/api/memory/nodes/${child.nodeId}?versionId=${child.versionId}&knownVersion=${memory.version}`,
    );
    const range = leaf.node.current.segment;
    if (range.revisionId !== source.revisionId || range.firstUnit !== cursor)
      throw new Error('Segment coverage or source mismatch');
    cursor = range.lastUnit + 1;
    actual += leaf.source.content.texts.map((t: any) => t.text).join('');
  }
  if (actual !== expected)
    throw new Error('Segment drilldown lost or reordered original text');
  exactCharacters += actual.length;
}
for (const row of report) {
  const replay = await request('/api/pushes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflow: 'summary',
      organizationMode: row.organizationMode,
      idempotencyKey: `organized-weekly:${row.revisionId}:organization-2-en:${row.organizationMode}`,
      projectScope: { mode: 'auto' },
      items: [
        {
          uploadId: row.uploadId,
          revisionId: row.revisionId,
          acceptPartial: row.acceptPartial,
        },
      ],
    }),
  });
  if (replay.id !== row.pushId || replay.commitVersion !== row.memoryVersion)
    throw new Error('Unchanged replay duplicated knowledge');
}
if ((await request('/api/memory/organized')).version !== memory.version)
  throw new Error('Replay changed memory');
await Bun.write(
  '/data/evaluations/organization-integrity.json',
  JSON.stringify(
    {
      version: memory.version,
      sources: memory.sources.length,
      segments: memory.segments.length,
      topics: memory.topics.length,
      projects: memory.projects.length,
      exactCharacters,
      historyPins: true,
      unpushedIsolation: true,
      replayNoop: true,
      projectContinuity: Object.fromEntries(
        [...bySource].map(([name, ids]) => [name, [...ids]]),
      ),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    accepted: true,
    version: memory.version,
    projects: memory.projects.map((p: any) => ({
      id: p.id,
      name: p.current.title,
    })),
    projectContinuity: Object.fromEntries(
      [...bySource].map(([name, ids]) => [name, [...ids]]),
    ),
  }),
);
