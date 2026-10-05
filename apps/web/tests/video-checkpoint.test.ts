import { expect, test } from 'bun:test';
import { buildVideo } from '../src/lib/server/agents/interpreter/video';
import { validateStage, type Stage } from '../src/lib/server/contracts';
import { config } from '../src/lib/server/config';
import { rm } from 'node:fs/promises';

test('interrupted audio processing resumes saved sections and rejects a mismatched checkpoint', async () => {
  const runId = crypto.randomUUID(),
    uploadId = crypto.randomUUID();
  const key = `assets/aa/${'a'.repeat(64)}`;
  const stage = (): Stage => ({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId,
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      label: 'Checkpoint regression',
      sourceTimeOrigin: 'unknown',
    },
    primitives: [],
    annotations: [],
    coverage: { complete: true, durationMs: null, warnings: [] },
    provenance: {
      adapter: 'video',
      model: null,
      modelRevision: null,
      promptVersion: null,
    },
  });
  const previousFetch = globalThis.fetch;
  const calls: number[] = [];
  let interrupted = false;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(url).endsWith('/probe'))
      return Response.json({ durationMs: 181000, hasAudio: true });
    if (!String(url).endsWith('/transcribe'))
      throw new Error('Unexpected external call');
    const body = JSON.parse(String(init?.body));
    calls.push(body.startMs);
    if (body.startMs === 180000 && !interrupted) {
      interrupted = true;
      return Response.json({ detail: 'Interrupted' }, { status: 500 });
    }
    return Response.json({
      durationMs: body.durationMs,
      model: 'MOSS',
      revision: 'pinned',
      truncated: false,
      segments: [{ start: 0, end: 0.5, speaker: 'S01', text: 'Saved speech' }],
    });
  }) as typeof fetch;
  try {
    await expect(
      buildVideo(stage(), key, runId, async () => {}),
    ).rejects.toThrow('Interrupted');
    const ready = await buildVideo(stage(), key, runId, async () => {});
    validateStage(ready);
    expect(calls).toEqual([0, 180000, 180000]);
    expect(ready.primitives).toHaveLength(2);
    expect(ready.primitives[1].locator).toMatchObject({
      startMs: 180000,
      endMs: 180500,
    });
    const path = `${config.dataRoot}/runs/${runId}/part-0.json`;
    const saved = await Bun.file(path).json();
    await Bun.write(
      path,
      JSON.stringify({ ...saved, storageKey: `assets/bb/${'b'.repeat(64)}` }),
    );
    await buildVideo(stage(), key, runId, async () => {});
    expect(calls).toEqual([0, 180000, 180000, 0]);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(`${config.dataRoot}/runs/${runId}`, {
      recursive: true,
      force: true,
    });
  }
});
