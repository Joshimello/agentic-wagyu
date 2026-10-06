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
  assertions: number;
  elapsedMs: number;
  acceptPartial: boolean;
  outcomes: unknown;
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
const uploads = await request('/api/uploads');
for (const source of corpus.sources) {
  const upload = uploads.find((u: any) => u.filename === source.filename);
  if (!upload) throw new Error(`Missing source ${source.filename}`);
  const detail = await request(`/api/uploads/${upload.id}`);
  const stage = detail.revisions.find(
    (r: any) => r.id === detail.upload.currentRevisionId,
  ).manifest;
  const batch = await request('/api/pushes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `weekly-progress:${stage.id}`,
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
    `/api/memory?knownVersion=${current.commitVersion}`,
  );
  report.push({
    filename: source.filename,
    family: source.family,
    uploadId: upload.id,
    revisionId: stage.id,
    pushId: batch.id,
    memoryVersion: current.commitVersion,
    projects: memory.projects.length,
    assertions: memory.statements.length,
    // Durable timing survives an interrupted evaluation or unchanged replay.
    elapsedMs: Date.parse(current.updatedAt) - Date.parse(current.createdAt),
    acceptPartial: !stage.coverage.complete,
    outcomes: current.outcomes,
  });
  await Bun.write(
    '/data/evaluations/weekly-pushes.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ event: 'push_committed', ...report.at(-1) }));
}
const memory = await request('/api/memory');
const bySource = new Map<string, Set<string>>();
for (const source of report) {
  const projects = new Set<string>();
  for (const claim of memory.statements)
    if (
      claim.history.some((v: any) =>
        v.evidence.some((e: any) => e.revisionId === source.revisionId),
      )
    )
      projects.add(claim.projectId);
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
    if (
      memory.statements.some((s: any) =>
        s.history.some((v: any) =>
          v.evidence.some((e: any) => e.revisionId === revision.id),
        ),
      )
    )
      throw new Error('Unpushed evidence entered memory');
}
console.log(
  JSON.stringify({
    accepted: true,
    version: memory.version,
    projects: memory.projects.map((p: any) => ({ id: p.id, name: p.name })),
    projectContinuity: Object.fromEntries(
      [...bySource].map(([name, ids]) => [name, [...ids]]),
    ),
  }),
);
