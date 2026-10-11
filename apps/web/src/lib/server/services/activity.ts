import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import {
  runs,
  uploads,
  pushBatches,
  revisions,
  translationJobs,
  summaryJobs,
  uploadSessions,
} from '../db/schema';
import type { ActivityTask } from '../../activity';

export async function listActivity(): Promise<ActivityTask[]> {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [sourceRows, pushes, translations, summaries, transfers] =
    await Promise.all([
      db
        .select({
          interpretation_runs: {
            id: runs.id,
            uploadId: runs.uploadId,
            inputRevisionId: runs.inputRevisionId,
            state: runs.state,
            progressPercent: runs.progressPercent,
            progress: runs.progress,
          },
          uploads: {
            id: uploads.id,
            filename: uploads.filename,
            metadata: uploads.metadata,
          },
        })
        .from(runs)
        .innerJoin(uploads, eq(runs.uploadId, uploads.id))
        .where(
          and(
            isNull(uploads.deletedAt),
            or(
              inArray(runs.state, ['queued', 'processing']),
              gte(runs.updatedAt, since),
            ),
          ),
        )
        .orderBy(desc(runs.updatedAt)),
      db
        .select({
          id: pushBatches.id,
          input: pushBatches.input,
          state: pushBatches.state,
          generation: pushBatches.generation,
          progressPercent: pushBatches.progressPercent,
          progress: pushBatches.progress,
        })
        .from(pushBatches)
        .where(
          or(
            inArray(pushBatches.state, ['queued', 'processing']),
            gte(pushBatches.updatedAt, since),
          ),
        )
        .orderBy(desc(pushBatches.updatedAt)),
      db
        .select({
          transcript_translations: {
            id: translationJobs.id,
            revisionId: translationJobs.revisionId,
            generation: translationJobs.generation,
            language: translationJobs.language,
            state: translationJobs.state,
            completedSegments: translationJobs.completedSegments,
            totalSegments: translationJobs.totalSegments,
          },
          uploads: {
            id: uploads.id,
            filename: uploads.filename,
            metadata: uploads.metadata,
          },
        })
        .from(translationJobs)
        .innerJoin(revisions, eq(translationJobs.revisionId, revisions.id))
        .innerJoin(uploads, eq(revisions.uploadId, uploads.id))
        .where(
          and(
            isNull(uploads.deletedAt),
            or(
              inArray(translationJobs.state, ['queued', 'processing']),
              gte(translationJobs.updatedAt, since),
            ),
          ),
        )
        .orderBy(desc(translationJobs.updatedAt)),
      db
        .select({
          meeting_summaries: {
            id: summaryJobs.id,
            revisionId: summaryJobs.revisionId,
            generation: summaryJobs.generation,
            state: summaryJobs.state,
            progressPercent: summaryJobs.progressPercent,
          },
          uploads: {
            id: uploads.id,
            filename: uploads.filename,
            metadata: uploads.metadata,
          },
        })
        .from(summaryJobs)
        .innerJoin(revisions, eq(summaryJobs.revisionId, revisions.id))
        .innerJoin(uploads, eq(revisions.uploadId, uploads.id))
        .where(
          and(
            isNull(uploads.deletedAt),
            or(
              inArray(summaryJobs.state, ['queued', 'processing']),
              gte(summaryJobs.updatedAt, since),
            ),
          ),
        )
        .orderBy(desc(summaryJobs.updatedAt)),
      db
        .select({
          id: uploadSessions.id,
          filenames: uploadSessions.filenames,
          state: uploadSessions.state,
        })
        .from(uploadSessions)
        .where(
          and(
            inArray(uploadSessions.state, ['uploading', 'canceled', 'failed']),
            gte(
              uploadSessions.updatedAt,
              new Date(Date.now() - 2 * 60 * 60 * 1000),
            ),
          ),
        )
        .orderBy(desc(uploadSessions.updatedAt)),
    ]);
  const pushUploadIds = [
    ...new Set(
      pushes.flatMap((push) => push.input.items.map((item) => item.uploadId)),
    ),
  ];
  const pushSources = pushUploadIds.length
    ? await db
        .select({ id: uploads.id, filename: uploads.filename })
        .from(uploads)
        .where(inArray(uploads.id, pushUploadIds))
    : [];
  const names = new Map(
    pushSources.map((source) => [source.id, source.filename]),
  );
  const tasks: ActivityTask[] = [];
  for (const row of sourceRows) {
    const run = row.interpretation_runs,
      source = row.uploads;
    const video = /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(source.filename);
    tasks.push({
      id: run.id,
      kind: 'interpretation',
      generation: 0,
      uploadId: source.id,
      title: source.metadata.label || source.filename,
      operation: run.inputRevisionId
        ? video
          ? 'Visual review'
          : 'Document review'
        : video
          ? 'Transcription'
          : 'Source processing',
      state: run.state,
      percent: run.progressPercent,
      phase: run.progress,
      href: `/staging/${source.id}`,
    });
  }
  for (const push of pushes)
    tasks.push({
      id: push.id,
      kind: 'push',
      generation: push.generation,
      title: `${names.get(push.input.items[0]?.uploadId) || 'Selected sources'}${push.input.items.length > 1 ? ` + ${push.input.items.length - 1}` : ''}`,
      operation: 'Push to memory',
      state: push.state,
      percent: push.progressPercent,
      phase: push.progress,
      href: `/pushes/${push.id}`,
    });
  for (const row of translations) {
    const job = row.transcript_translations;
    tasks.push({
      id: job.id,
      kind: 'translation',
      generation: job.generation,
      uploadId: row.uploads.id,
      title: row.uploads.metadata.label || row.uploads.filename,
      operation:
        job.language === 'en' ? 'English translation' : 'Chinese translation',
      state: job.state,
      percent:
        job.state === 'ready'
          ? 100
          : Math.min(
              99,
              Math.floor(
                (job.completedSegments / Math.max(1, job.totalSegments)) * 100,
              ),
            ),
      phase: `${job.completedSegments} / ${job.totalSegments} entries`,
      href: `/staging/${row.uploads.id}?revision=${job.revisionId}#spoken-transcript`,
    });
  }
  for (const row of summaries) {
    const job = row.meeting_summaries;
    tasks.push({
      id: job.id,
      kind: 'summary',
      generation: job.generation,
      uploadId: row.uploads.id,
      title: row.uploads.metadata.label || row.uploads.filename,
      operation: 'Meeting summary',
      state: job.state,
      percent: job.progressPercent,
      phase:
        job.progressPercent >= 80
          ? 'Writing the summary'
          : 'Reading the meeting',
      href: `/staging/${row.uploads.id}?revision=${job.revisionId}#meeting-summary`,
    });
  }
  for (const session of transfers)
    if (session.filenames.length)
      tasks.push({
        id: session.id,
        kind: 'upload',
        generation: 0,
        title: `${session.filenames[0]}${session.filenames.length > 1 ? ` + ${session.filenames.length - 1}` : ''}`,
        operation: 'Upload',
        state: session.state,
        percent: null,
        phase: 'Uploading source files',
        href: '/',
      });
  return tasks.sort(
    (a, b) =>
      Number(['uploading', 'queued', 'processing'].includes(b.state)) -
      Number(['uploading', 'queued', 'processing'].includes(a.state)),
  );
}
