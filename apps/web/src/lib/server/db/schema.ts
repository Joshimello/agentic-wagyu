import { pgTable, uuid, text, timestamp, integer, bigint, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Stage } from '../contracts';
const createdAt = () => timestamp('created_at',{withTimezone:true}).notNull().defaultNow();
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey(), sha256: text('sha256').notNull().unique(),
  storageKey: text('storage_key').notNull(), mime: text('mime').notNull(),
  bytes: bigint('bytes',{mode:'number'}).notNull(), createdAt: createdAt()
});
export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey(), assetId: uuid('asset_id').notNull().references(()=>assets.id),
  filename: text('filename').notNull(), metadata: jsonb('metadata').$type<Stage['metadata']>().notNull(),
  currentRevisionId: uuid('current_revision_id'), createdAt: createdAt()
});
export const runs = pgTable('interpretation_runs', {
  id: uuid('id').primaryKey(), uploadId: uuid('upload_id').notNull().references(()=>uploads.id),
  state: text('state').notNull().default('queued'), progress: text('progress').notNull().default('Waiting for worker'),
  attempts: integer('attempts').notNull().default(0), error: text('error'),
  revisionId: uuid('revision_id'), createdAt: createdAt(), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()
});
export const outbox = pgTable('job_outbox', {
  id: uuid('id').primaryKey().references(()=>runs.id), dispatchedAt: timestamp('dispatched_at',{withTimezone:true}), createdAt: createdAt()
});
export const revisions = pgTable('staging_revisions', {
  id: uuid('id').primaryKey(), uploadId: uuid('upload_id').notNull().references(()=>uploads.id),
  runId: uuid('run_id').references(()=>runs.id), parentRevisionId: uuid('parent_revision_id'),
  manifest: jsonb('manifest').$type<Stage>().notNull(), createdAt: createdAt()
}, t=>[uniqueIndex('staging_run_unique').on(t.runId)]);
export const memoryCommits = pgTable('memory_commits', {
  id: uuid('id').primaryKey(), version: integer('version').notNull().unique(), createdAt: createdAt()
});
