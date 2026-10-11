import { afterAll, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  assets,
  uploads,
  revisions,
  summaryJobs,
  summaryOutbox,
  runs,
  evidenceAdmissions,
} from '../src/lib/server/db/schema';
import type { Stage } from '../src/lib/server/contracts';
import type { MeetingSummary } from '../src/lib/server/contracts/summaries';
import {
  getSummary,
  requestSummary,
  cancelSummary,
} from '../src/lib/server/services/summaries';
import { summarizeMeeting } from '../src/lib/server/agents/summary';
import {
  beginUploadSession,
  cancelUploadSession,
  failUploadSession,
  getUploadSession,
} from '../src/lib/server/services/upload-sessions';
import {
  acceptUploadBatch,
  getUpload,
} from '../src/lib/server/services/uploads';
import { removeUploads } from '../src/lib/server/services/removal';
import { correctStage } from '../src/lib/server/services/staging';
import { listActivity } from '../src/lib/server/services/activity';
import { dispatchSummaries } from '../src/lib/server/jobs/summaries';
import {
  createResearch,
  cancelResearch,
  retryResearch,
} from '../src/lib/server/services/research';
import { recoverInterrupted } from '../src/lib/server/jobs/operation';

const enabled =
  process.env.ACTIVITY_TEST_DATABASE === '1' ||
  process.env.TEST_SUITE === 'activity';
if (
  enabled &&
  (!/^chronicler_activity_test_/.test(
    new URL(process.env.DATABASE_URL!).pathname.slice(1),
  ) ||
    !(
      process.env.DATA_ROOT?.startsWith('/tmp/chronicler-activity') ||
      (process.env.TEST_SUITE === 'activity' &&
        process.env.DATA_ROOT?.startsWith('/data/tests/'))
    ))
)
  throw new Error('Activity tests require isolated database and storage');
const check = test.skipIf(!enabled);

check(
  'Researcher questions remain visible in activity across cancel and retry generations',
  async () => {
    const run = await createResearch({
      question: 'What evidence is available?',
      idempotencyKey: crypto.randomUUID(),
    });
    const queued = (await listActivity()).find(
      (task) => task.kind === 'research' && task.id === run.id,
    );
    expect(queued).toMatchObject({
      title: 'What evidence is available?',
      state: 'queued',
      generation: 0,
      href: `/ask/${run.id}`,
    });
    expect(Object.keys(queued!)).not.toContain('trace');
    await cancelResearch(run.id, 0);
    expect(
      (await listActivity()).find((task) => task.id === run.id)?.state,
    ).toBe('canceled');
    await retryResearch(run.id);
    await expect(cancelResearch(run.id, 0)).rejects.toThrow('Question changed');
    expect(
      (await listActivity()).find((task) => task.id === run.id),
    ).toMatchObject({ state: 'queued', generation: 1 });
  },
);

check(
  'interrupted meeting summaries recover with a new generation and retain their checkpoint',
  async () => {
    const stage = await fixture();
    const job = await requestSummary(stage.uploadId, { revisionId: stage.id });
    const saved = result(
      new Set(
        stage.primitives
          .filter((part) => part.kind === 'text')
          .map((part) => part.id),
      ),
    );
    await db
      .update(summaryJobs)
      .set({ state: 'processing', checkpoint: [saved] })
      .where(eq(summaryJobs.id, job.id!));
    await db
      .update(summaryOutbox)
      .set({ dispatchedAt: new Date() })
      .where(eq(summaryOutbox.id, job.id!));
    await recoverInterrupted(['summary']);
    const [recovered] = await db
      .select()
      .from(summaryJobs)
      .where(eq(summaryJobs.id, job.id!));
    expect(recovered.state).toBe('queued');
    expect(recovered.generation).toBe(job.generation + 1);
    expect(recovered.checkpoint).toEqual([saved]);
    expect(
      (
        await db
          .select()
          .from(summaryOutbox)
          .where(eq(summaryOutbox.id, job.id!))
      )[0].dispatchedAt,
    ).toBeNull();
  },
);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});

async function fixture(long = false) {
  const assetId = crypto.randomUUID(),
    uploadId = crypto.randomUUID(),
    revisionId = crypto.randomUUID();
  const stage: Stage = {
    schemaVersion: 1,
    id: revisionId,
    uploadId,
    rawAssetId: assetId,
    parentRevisionId: null,
    createdAt: new Date().toISOString(),
    metadata: {
      uploader: 'local',
      uploadedAt: new Date().toISOString(),
      sourceTime: null,
      sourceTimeOrigin: 'unknown',
      label: 'Reviewed research meeting',
    },
    primitives: [0, 1, 2].map((index) => ({
      id: crypto.randomUUID(),
      kind: 'text' as const,
      role: 'asr' as const,
      text: long
        ? `${index}: Research observation. `.repeat(500)
        : `${index}: Research observation.`,
      speaker: 'S01',
      locator: {
        kind: 'media' as const,
        timeline: 'container' as const,
        startMs: index * 1000,
        endMs: (index + 1) * 1000,
      },
    })),
    annotations: [],
    coverage: { complete: true, durationMs: 3000, warnings: [] },
    provenance: {
      adapter: 'video',
      model: 'MOSS',
      modelRevision: 'pinned',
      promptVersion: null,
    },
  };
  await db.insert(assets).values({
    id: assetId,
    sha256: crypto.randomUUID(),
    storageKey: `tests/${assetId}`,
    mime: 'video/mp4',
    bytes: 1,
  });
  await db.insert(uploads).values({
    id: uploadId,
    assetId,
    filename: 'research-meeting.mp4',
    metadata: stage.metadata,
    currentRevisionId: revisionId,
  });
  await db
    .insert(revisions)
    .values({ id: revisionId, uploadId, manifest: stage });
  return stage;
}
function result(ids: ReadonlySet<string>): MeetingSummary {
  return {
    overview: {
      text: 'Researchers reviewed current results and uncertainties.',
      evidenceIds: [...ids].slice(0, 2),
    },
    highlights: [],
    topics: [
      {
        title: 'Research results',
        kind: 'topic',
        summary: 'Results remain under review.',
        evidenceIds: [...ids].slice(0, 2),
      },
    ],
  };
}
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

check(
  'summary requests deduplicate and pin owned revisions without admitting memory',
  async () => {
    const stage = await fixture();
    const [a, b] = await Promise.all([
      requestSummary(stage.uploadId, { revisionId: stage.id }),
      requestSummary(stage.uploadId, { revisionId: stage.id }),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      requestSummary(crypto.randomUUID(), { revisionId: stage.id }),
    ).rejects.toThrow();
    await expect(getSummary(crypto.randomUUID(), stage.id)).rejects.toThrow();
    await summarizeMeeting(a.id!, {
      summarize: async (_payload, ids) => result(ids),
    });
    const ready = await getSummary(stage.uploadId, stage.id);
    expect(ready.state).toBe('ready');
    expect(ready.progressPercent).toBe(100);
    expect((await getUpload(stage.uploadId)).upload.currentRevisionId).toBe(
      stage.id,
    );
    expect(
      await db
        .select()
        .from(evidenceAdmissions)
        .where(eq(evidenceAdmissions.revisionId, stage.id)),
    ).toHaveLength(0);
  },
);

check(
  'all transcript fragments are read before bounded summary merging',
  async () => {
    const stage = await fixture(true);
    const job = await requestSummary(stage.uploadId, { revisionId: stage.id });
    const read: string[] = [];
    let merges = 0;
    await summarizeMeeting(job.id!, {
      summarize: async (payload, ids) => {
        const part = payload as { task: string; excerpts?: { text: string }[] };
        if (part.task === 'read_source')
          read.push(...part.excerpts!.map((p) => p.text));
        else merges++;
        return result(ids);
      },
    });
    expect(read.join('')).toBe(
      stage.primitives.map((p) => (p.kind === 'text' ? p.text : '')).join(''),
    );
    expect(merges).toBeGreaterThan(0);
    expect((await getSummary(stage.uploadId, stage.id)).state).toBe('ready');
  },
);

check(
  'cancellation aborts only its summary, rejects late results and resumes completed reading',
  async () => {
    const stage = await fixture(true);
    const job = await requestSummary(stage.uploadId, { revisionId: stage.id });
    const reached = latch(),
      release = latch();
    let calls = 0,
      signal: AbortSignal | undefined;
    const running = summarizeMeeting(job.id!, {
      summarize: async (_payload, ids, currentSignal) => {
        calls++;
        if (calls === 2) {
          signal = currentSignal;
          reached.resolve();
          await release.promise;
        }
        return result(ids);
      },
    });
    await reached.promise;
    await expect(cancelSummary(crypto.randomUUID(), job.id!)).rejects.toThrow();
    const canceled = await cancelSummary(stage.uploadId, job.id!);
    expect(canceled.state).toBe('canceled');
    await Bun.sleep(650);
    expect(signal?.aborted).toBe(true);
    release.resolve();
    await running;
    const [row] = await db
      .select()
      .from(summaryJobs)
      .where(eq(summaryJobs.id, job.id!));
    expect(row.summary).toBeNull();
    expect(row.checkpoint).toHaveLength(1);
    expect(row.progressPercent).toBeLessThan(100);
    await requestSummary(stage.uploadId, { revisionId: stage.id });
    await expect(cancelSummary(stage.uploadId, job.id!, 0)).rejects.toThrow(
      'attempt changed',
    );
    let staleCalls = 0;
    await summarizeMeeting(job.id!, {
      generation: 0,
      summarize: async (_payload, ids) => {
        staleCalls++;
        return result(ids);
      },
    });
    expect(staleCalls).toBe(0);
    let resumedFirstBlock = false;
    await summarizeMeeting(job.id!, {
      summarize: async (payload, ids) => {
        if ((payload as { block?: number }).block === 1)
          resumedFirstBlock = true;
        return result(ids);
      },
    });
    expect(resumedFirstBlock).toBe(false);
    expect((await getSummary(stage.uploadId, stage.id)).state).toBe('ready');
    expect((await cancelSummary(stage.uploadId, job.id!)).state).toBe('ready');
  },
);

check(
  'corrected revisions get independent summaries and archived work cannot be redispatched',
  async () => {
    const stage = await fixture();
    const old = await requestSummary(stage.uploadId, { revisionId: stage.id });
    await summarizeMeeting(old.id!, {
      summarize: async (_payload, ids) => result(ids),
    });
    const corrected = await correctStage(stage.uploadId, {
      baseRevisionId: stage.id,
      label: 'Reviewed correction',
      sourceTime: null,
      edits: [
        {
          primitiveId: stage.primitives[0].id,
          text: 'A corrected research result.',
          speaker: 'S01',
        },
      ],
    });
    const next = await getSummary(stage.uploadId, corrected.id);
    expect(next.id).not.toBe(old.id);
    expect(next.state).toBe('queued');
    await removeUploads({ uploadIds: [stage.uploadId] });
    expect((await getSummary(stage.uploadId, corrected.id)).state).toBe(
      'canceled',
    );
    expect((await getSummary(stage.uploadId, stage.id)).state).toBe('ready');
    await expect(
      requestSummary(stage.uploadId, { revisionId: corrected.id }),
    ).rejects.toThrow();
    const sends: string[] = [];
    await dispatchSummaries({
      send: async (_queue: string, data: { summaryId: string }) => {
        sends.push(data.summaryId);
      },
    } as unknown as PgBoss);
    expect(sends).not.toContain(next.id!);
    const [outbox] = await db
      .select()
      .from(summaryOutbox)
      .where(eq(summaryOutbox.id, next.id!));
    expect(outbox.dispatchedAt).not.toBeNull();
  },
);

check(
  'upload cancellation before begin and before acceptance prevents durable source jobs',
  async () => {
    const id = crypto.randomUUID();
    await cancelUploadSession(id);
    expect(
      (await beginUploadSession({ id, filenames: ['small.txt'] })).state,
    ).toBe('canceled');
    await expect(
      acceptUploadBatch(
        [new File(['Evidence'], 'small.txt')],
        {},
        { sessionId: id },
      ),
    ).rejects.toThrow('canceled');
    expect((await getUploadSession(id)).accepted).toHaveLength(0);
  },
);

check(
  'late upload cancellation fences accepted processing but preserves original evidence',
  async () => {
    const id = crypto.randomUUID();
    await beginUploadSession({ id, filenames: ['queued-notes.txt'] });
    const [accepted] = await acceptUploadBatch(
      [new File(['Original source evidence'], 'queued-notes.txt')],
      {},
      { sessionId: id },
    );
    await failUploadSession(id);
    expect((await getUploadSession(id)).state).toBe('accepted');
    await cancelUploadSession(id);
    await cancelUploadSession(id);
    const source = await getUpload(accepted.uploadId);
    expect(source.run.state).toBe('canceled');
    expect(source.asset.bytes).toBeGreaterThan(0);
    expect(source.upload.deletedAt).toBeNull();
    await expect(
      acceptUploadBatch(
        [new File(['Different input'], 'queued-notes.txt')],
        {},
        { sessionId: id },
      ),
    ).rejects.toThrow();
  },
);

check(
  'failed transfer fences acceptance and activity exposes source names without private caches',
  async () => {
    const id = crypto.randomUUID();
    await beginUploadSession({ id, filenames: ['Transfer meeting.mp4'] });
    await failUploadSession(id);
    await expect(
      acceptUploadBatch(
        [new File(['data'], 'Transfer meeting.mp4')],
        {},
        { sessionId: id },
      ),
    ).rejects.toThrow();
    const stage = await fixture();
    const job = await requestSummary(stage.uploadId, { revisionId: stage.id });
    const rows = await listActivity();
    const summary = rows.find(
      (row) => row.kind === 'summary' && row.id === job.id,
    );
    expect(summary?.operation).toBe('Meeting summary');
    expect(summary?.title).toBe('Reviewed research meeting');
    expect(summary?.href).toContain(stage.id);
    expect(Object.keys(summary!)).not.toContain('checkpoint');
    expect(rows.find((row) => row.id === id)?.state).toBe('failed');
  },
);

check('invalid model citations cannot become a completed summary', async () => {
  const stage = await fixture();
  const job = await requestSummary(stage.uploadId, { revisionId: stage.id });
  await expect(
    summarizeMeeting(job.id!, {
      summarize: async () => result(new Set([crypto.randomUUID()])),
    }),
  ).rejects.toThrow('outside its reviewed source');
  const status = await getSummary(stage.uploadId, stage.id);
  expect(status.state).toBe('failed');
  expect(status.summary).toBeNull();
  expect(status.progressPercent).toBeLessThan(100);
});

check(
  'activity includes every queued source instead of losing tasks behind recent completions',
  async () => {
    const expected: string[] = [];
    for (let index = 0; index < 30; index++) {
      const stage = await fixture();
      expected.push(
        (await requestSummary(stage.uploadId, { revisionId: stage.id })).id!,
      );
    }
    const actual = new Set(
      (await listActivity())
        .filter((task) => task.kind === 'summary' && task.state === 'queued')
        .map((task) => task.id),
    );
    expect(expected.every((id) => actual.has(id))).toBe(true);
  },
);
