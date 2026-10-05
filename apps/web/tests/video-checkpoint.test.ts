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
      return Response.json({ durationMs: 5401000, hasAudio: true });
    if (!String(url).endsWith('/transcribe'))
      throw new Error('Unexpected external call');
    const body = JSON.parse(String(init?.body));
    calls.push(body.startMs);
    if (body.startMs === 5400000 && !interrupted) {
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
    expect(calls).toEqual([0, 5400000, 5400000]);
    expect(ready.primitives).toHaveLength(2);
    expect(ready.primitives[1].locator).toMatchObject({
      startMs: 5400000,
      endMs: 5400500,
    });
    const path = `${config.dataRoot}/runs/${runId}/part-5400000-0.json`;
    const saved = await Bun.file(path).json();
    await Bun.write(
      path,
      JSON.stringify({ ...saved, storageKey: `assets/bb/${'b'.repeat(64)}` }),
    );
    await buildVideo(stage(), key, runId, async () => {});
    expect(calls).toEqual([0, 5400000, 5400000, 0]);
  } finally {
    globalThis.fetch = previousFetch;
    await rm(`${config.dataRoot}/runs/${runId}`, {
      recursive: true,
      force: true,
    });
  }
});

test('early-ending long ASR falls back to checkpointed longer windows without conflating speakers', async () => {
  const runId = crypto.randomUUID(),
    key = `assets/aa/${'a'.repeat(64)}`;
  const originalFetch = globalThis.fetch;
  const calls: number[][] = [];
  const make = (): Stage => ({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    rawAssetId: crypto.randomUUID(),
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      label: 'Recovery regression',
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
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(url).endsWith('/probe'))
      return Response.json({ durationMs: 3904107, hasAudio: true });
    if (!String(url).endsWith('/transcribe'))
      throw new Error('Unexpected model request');
    const body = JSON.parse(String(init?.body));
    calls.push([body.startMs, body.durationMs]);
    return Response.json({
      durationMs: body.durationMs,
      model: 'MOSS',
      revision: 'pinned',
      truncated: false,
      incomplete: body.durationMs > 1800000,
      segments: [
        { start: 0, end: 0.5, speaker: 'S01', text: 'Recovered speech' },
      ],
    });
  }) as typeof fetch;
  try {
    const value = await buildVideo(make(), key, runId, async () => {});
    validateStage(value);
    expect(calls).toEqual([
      [0, 3904107],
      [0, 1800000],
      [1800000, 1800000],
      [3600000, 304107],
    ]);
    expect(value.provenance.transcription).toMatchObject({
      windowMs: 1800000,
      scope: 'window',
    });
    expect(
      value.primitives.map((p) => (p.kind === 'text' ? p.speaker : null)),
    ).toEqual(['Part 1 · S01', 'Part 2 · S01', 'Part 3 · S01']);
    expect(value.coverage.warnings.join(' ')).toContain(
      'long MOSS pass ended early',
    );
    await buildVideo(make(), key, runId, async () => {});
    expect(calls).toHaveLength(4);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(`${config.dataRoot}/runs/${runId}`, {
      recursive: true,
      force: true,
    });
  }
});
