import { validateStage } from '../src/lib/server/contracts';
import { unzipSync, strFromU8 } from 'fflate';
import { memoryCount } from '../src/lib/server/services/uploads';
const url = process.env.WEB_URL ?? 'http://web:5173';
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const form = new FormData();
form.set(
  'file',
  new File(
    [await Bun.file('/data/fixtures/meeting.mp4').arrayBuffer()],
    'meeting.mp4',
    { type: 'video/mp4' },
  ),
);
form.set('label', 'Synthetic meeting pilot');
const accepted = await fetch(`${url}/api/uploads`, {
  method: 'POST',
  headers: { Origin: 'http://localhost:5173' },
  body: form,
});
check(accepted.status === 202, `Video upload rejected (${accepted.status})`);
const { uploadId } = await accepted.json();
console.log(JSON.stringify({ uploadId, status: 'uploaded' }));
async function waitReady() {
  const until = Date.now() + 960000;
  let item;
  while (Date.now() < until) {
    item = await (await fetch(`${url}/api/uploads/${uploadId}`)).json();
    if (['ready', 'ready_with_warnings'].includes(item.run.state)) return item;
    if (item.run.state === 'failed') throw new Error(item.run.error);
    await Bun.sleep(1000);
  }
  throw new Error('Video staging timed out');
}
const detail = await waitReady();
const stage = validateStage(
  detail.revisions.find((r: any) => r.id === detail.upload.currentRevisionId)
    .manifest,
);
check(
  stage.annotations.length > 0,
  'Live visual agent produced no validated annotations',
);
check(
  stage.primitives.some((p) => p.kind === 'image'),
  'No referenced frames',
);
for (const p of stage.primitives)
  if (p.kind === 'image') {
    const r = await fetch(`${url}/api/assets/${p.assetId}`);
    check(
      r.ok && r.headers.get('content-type') === 'image/jpeg',
      'Frame cannot be opened',
    );
  }
const visualText = stage.annotations
  .map((a) => a.text)
  .join(' ')
  .toLowerCase();
for (const fact of ['friday', '12', 'green'])
  check(visualText.includes(fact), `Missing visual fact: ${fact}`);
const transcript = stage.primitives
  .filter((p) => p.kind === 'text')
  .map((p) => (p.kind === 'text' ? p.text : ''))
  .join(' ');
check(
  transcript.includes('Friday') && transcript.includes('customers'),
  'Spoken transcript lost',
);
const text = stage.primitives.find((p) => p.kind === 'text')!;
const corrected = await fetch(`${url}/api/uploads/${uploadId}/corrections`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    baseRevisionId: stage.id,
    label: 'Reviewed synthetic meeting',
    sourceTime: null,
    edits: [
      {
        primitiveId: text.id,
        text: 'Corrected meeting introduction.',
        speaker: 'Alice (user label)',
      },
    ],
  }),
});
check(corrected.status === 201, 'Correction rejected');
const revision = validateStage(await corrected.json());
check(
  revision.id !== stage.id && revision.parentRevisionId === stage.id,
  'Correction did not create a revision',
);
const stale = await fetch(`${url}/api/uploads/${uploadId}/corrections`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    baseRevisionId: stage.id,
    label: 'stale',
    sourceTime: null,
    edits: [],
  }),
});
check(stale.status === 409, 'Stale correction overwrote a newer revision');
const old = await (
  await fetch(
    `${url}/api/uploads/${uploadId}/export?revision=${stage.id}&format=json`,
  )
).json();
check(
  Bun.deepEquals(validateStage(old), stage),
  'Historical source revision was mutated',
);
const markdown = await (
  await fetch(`${url}/api/uploads/${uploadId}/export`)
).text();
check(
  markdown.includes('Corrected meeting introduction.') &&
    markdown.includes('## Visual context'),
  'Readable export failed',
);
const zip = await fetch(`${url}/api/uploads/${uploadId}/export?format=zip`);
check(zip.ok, 'Offline bundle failed');
const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
check(
  !!files['transcript.md'] && !!files['staging.json'],
  'Bundle manifest/transcript absent',
);
check(
  Object.keys(files).some((f) => f.startsWith('frames/')),
  'Bundle frames absent',
);
check(
  !strFromU8(files['transcript-with-visual-context.md']).includes(
    'http://localhost:5173/api/assets/',
  ),
  'Bundle has non-portable frame links',
);
const raw = await fetch(`${url}/api/assets/${stage.rawAssetId}`, {
  headers: { Range: 'bytes=0-31' },
});
check(
  raw.status === 206 && (await raw.arrayBuffer()).byteLength === 32,
  'Video range request failed',
);
const invalid = await fetch(`${url}/api/assets/${stage.rawAssetId}`, {
  headers: { Range: 'bytes=99999999999-' },
});
check(invalid.status === 416, 'Invalid range accepted');
const retry = await fetch(`${url}/api/uploads/${uploadId}/retry`, {
  method: 'POST',
  headers: { Origin: 'http://localhost:5173' },
});
check(retry.status === 202, `Video reprocessing rejected (${retry.status})`);
await Bun.sleep(1200);
const after = await waitReady();
check(
  after.revisions.length === 3,
  'Video retry did not preserve correction/history',
);
check((await memoryCount()) === 0, 'Video/correction/retry entered memory');
const report = {
  uploadId,
  revisionId: stage.id,
  annotations: stage.annotations.length,
  frames: stage.primitives.filter((p) => p.kind === 'image').length,
  visualFacts: true,
  validReferences: true,
  correction: true,
  staleCorrectionRejected: true,
  offlineBundle: true,
  rangeRequests: true,
  retry: true,
  memoryCommits: 0,
  speakerLabels: [
    ...new Set(
      stage.primitives.flatMap((p) =>
        p.kind === 'text' && p.speaker ? [p.speaker] : [],
      ),
    ),
  ],
  warnings: stage.coverage.warnings,
};
await Bun.write(
  '/data/fixtures/video-evaluation.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await (await import('../src/lib/server/db/client')).sqlClient.end();
