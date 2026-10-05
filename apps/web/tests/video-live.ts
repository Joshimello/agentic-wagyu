/** Read-only acceptance checks on real, already staged recordings. Never edits their evidence. */
import { validateStage } from '../src/lib/server/contracts';
import { unzipSync, strFromU8 } from 'fflate';
import { memoryCount } from '../src/lib/server/services/uploads';
import corpus from '../../../evals/meetings.json';
import { config } from '../src/lib/server/config';
import { audioSections } from '../src/lib/server/agents/interpreter/audio-sections';
const url = process.env.WEB_URL ?? 'http://web:5173';
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const uploads = await (await fetch(`${url}/api/uploads`)).json();
const reports = [];
for (const recording of corpus.recordings) {
  const upload = uploads.find((u: any) => u.filename === recording.filename);
  check(upload, `Upload ${recording.filename} first`);
  check(
    ['ready', 'ready_with_warnings'].includes(upload.run.state),
    `${recording.filename} is not ready: ${upload.run.progress}`,
  );
  const detail = await (await fetch(`${url}/api/uploads/${upload.id}`)).json();
  const stage = validateStage(
    detail.revisions.find((r: any) => r.id === detail.upload.currentRevisionId)
      .manifest,
  );
  check(
    stage.coverage.durationMs === recording.durationMs,
    'Full recording timeline is missing',
  );
  const spoken = stage.primitives.filter((p) => p.kind === 'text');
  check(spoken.length > 0, 'No extracted speech');
  check(stage.annotations.length > 0, 'No validated visual context');
  for (const p of stage.primitives)
    if (p.kind === 'image') {
      const response = await fetch(`${url}/api/assets/${p.assetId}`);
      check(
        response.ok && response.headers.get('content-type') === 'image/jpeg',
        'Frame unavailable',
      );
    }
  const exported = validateStage(
    await (
      await fetch(
        `${url}/api/uploads/${upload.id}/export?revision=${stage.id}&format=json`,
      )
    ).json(),
  );
  check(
    Bun.deepEquals(exported, stage),
    'Pinned export differs from staged evidence',
  );
  const zip = await fetch(
    `${url}/api/uploads/${upload.id}/export?revision=${stage.id}&format=zip`,
  );
  check(zip.ok, 'Offline export failed');
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  check(files['transcript.md'] && files['staging.json'], 'Bundle incomplete');
  check(
    Object.keys(files).some((f) => f.startsWith('frames/')),
    'Referenced images not bundled',
  );
  check(
    !strFromU8(files['transcript-with-visual-context.md']).includes(
      'http://localhost:5173/api/assets/',
    ),
    'Non-portable links in bundle',
  );
  const raw = await fetch(`${url}/api/assets/${stage.rawAssetId}`, {
    headers: { Range: 'bytes=0-31' },
  });
  check(
    raw.status === 206 && (await raw.arrayBuffer()).byteLength === 32,
    'Raw range request failed',
  );
  const invalid = await fetch(`${url}/api/assets/${stage.rawAssetId}`, {
    headers: { Range: 'bytes=99999999999-' },
  });
  check(invalid.status === 416, 'Invalid range accepted');
  const sections = [];
  for (const section of audioSections(recording.durationMs)) {
    const checkpoint = await Bun.file(
      `${config.dataRoot}/runs/${upload.run.id}/part-${section.index}.json`,
    ).json();
    check(
      checkpoint.storageKey.endsWith(recording.sha256) &&
        checkpoint.startMs === section.startMs &&
        checkpoint.durationMs === section.durationMs,
      'Checkpoint source/timeline mismatch',
    );
    const r = checkpoint.result;
    sections.push({
      index: section.index,
      startMs: section.startMs,
      durationMs: section.durationMs,
      elapsedSeconds: r.elapsedSeconds,
      peakGiB: r.peakGiB,
      generatedTokens: r.generated_tokens,
      segments: r.segments.length,
      localSpeakerLabels: [...new Set(r.segments.map((s: any) => s.speaker))],
      truncated: r.truncated,
    });
  }
  reports.push({
    filename: recording.filename,
    uploadId: upload.id,
    revisionId: stage.id,
    durationMs: stage.coverage.durationMs,
    speechSegments: spoken.length,
    frames: stage.primitives.filter((p) => p.kind === 'image').length,
    annotations: stage.annotations.length,
    sectionCount: sections.length,
    inferenceSeconds: sections.reduce((n, s) => n + s.elapsedSeconds, 0),
    peakGiB: Math.max(...sections.map((s) => s.peakGiB)),
    truncatedSections: sections.filter((s) => s.truncated).length,
    sections,
    warnings: stage.coverage.warnings,
    transcriptionAccuracy: 'unreviewed',
    speakerAccuracy: 'unreviewed',
    validReferences: true,
    offlineExport: true,
  });
}
check((await memoryCount()) === 0, 'Staging entered memory');
await Bun.write(
  '/data/evaluations/meetings.json',
  JSON.stringify({ reports, memoryCommits: 0 }, null, 2),
);
console.log(JSON.stringify(reports, null, 2));
await (await import('../src/lib/server/db/client')).sqlClient.end();
