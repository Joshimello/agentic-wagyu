import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';
import type { Stage } from '../contracts';
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  createdAt: createdAt(),
});
export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id),
  filename: text('filename').notNull(),
  metadata: jsonb('metadata').$type<Stage['metadata']>().notNull(),
  currentRevisionId: uuid('current_revision_id'),
  createdAt: createdAt(),
});
export const runs = pgTable('interpretation_runs', {
  id: uuid('id').primaryKey(),
  uploadId: uuid('upload_id')
    .notNull()
    .references(() => uploads.id),
  state: text('state').notNull().default('queued'),
  progress: text('progress').notNull().default('Waiting for worker'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  revisionId: uuid('revision_id'),
  inputRevisionId: uuid('input_revision_id'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const outbox = pgTable('job_outbox', {
  id: uuid('id')
    .primaryKey()
    .references(() => runs.id),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export const revisions = pgTable(
  'staging_revisions',
  {
    id: uuid('id').primaryKey(),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => uploads.id),
    runId: uuid('run_id').references(() => runs.id),
    parentRevisionId: uuid('parent_revision_id'),
    manifest: jsonb('manifest').$type<Stage>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('staging_run_unique').on(t.runId)],
);
export const memoryCommits = pgTable('memory_commits', {
  id: uuid('id').primaryKey(),
  version: integer('version').notNull().unique(),
  pushId: uuid('push_id').unique(),
  createdAt: createdAt(),
});
export const stagingSelections = pgTable('staging_selections', {
  uploadId: uuid('upload_id')
    .primaryKey()
    .references(() => uploads.id),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => revisions.id),
  acceptPartial: boolean('accept_partial').notNull().default(false),
  createdAt: createdAt(),
});

// Memory identities and immutable accepted records. Operational checkpoints live on batches.
export const pushBatches = pgTable('push_batches', {
  id: uuid('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  fingerprint: text('fingerprint').notNull(),
  input: jsonb('input')
    .$type<import('../contracts/memory').PushInput>()
    .notNull(),
  state: text('state').notNull().default('queued'),
  baseVersion: integer('base_version').notNull(),
  commitVersion: integer('commit_version'),
  attempts: integer('attempts').notNull().default(0),
  progress: text('progress').notNull().default('Waiting for Chronicler'),
  error: text('error'),
  checkpoints: jsonb('checkpoints')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  plan: jsonb('plan').$type<import('../contracts/memory').Plan>(),
  outcomes: jsonb('outcomes')
    .$type<import('../contracts/memory').Plan['outcomes']>()
    .notNull()
    .default([]),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const pushItems = pgTable(
  'push_items',
  {
    id: uuid('id').primaryKey(),
    pushId: uuid('push_id')
      .notNull()
      .references(() => pushBatches.id),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => uploads.id),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    acceptPartial: boolean('accept_partial').notNull(),
  },
  (t) => [uniqueIndex('push_item_unique').on(t.pushId, t.uploadId)],
);
export const chroniclerOutbox = pgTable('chronicler_outbox', {
  id: uuid('id')
    .primaryKey()
    .references(() => pushBatches.id),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export const memoryProjects = pgTable('memory_projects', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull(),
  evidence: jsonb('evidence')
    .$type<import('../contracts/memory').Evidence[]>()
    .notNull(),
  origin: text('origin').$type<'model' | 'user'>().notNull(),
  createdVersion: integer('created_version')
    .notNull()
    .references(() => memoryCommits.version),
});
export const memoryEntities = pgTable('memory_entities', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => memoryProjects.id),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  evidence: jsonb('evidence')
    .$type<import('../contracts/memory').Evidence[]>()
    .notNull(),
  createdVersion: integer('created_version')
    .notNull()
    .references(() => memoryCommits.version),
});
export const statements = pgTable('statements', {
  id: uuid('id').primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => memoryProjects.id),
  type: text('type')
    .$type<import('../contracts/memory').AssertionProposal['type']>()
    .notNull(),
  stateKey: text('state_key').notNull(),
  createdVersion: integer('created_version')
    .notNull()
    .references(() => memoryCommits.version),
});
export const statementVersions = pgTable('statement_versions', {
  id: uuid('id').primaryKey(),
  statementId: uuid('statement_id')
    .notNull()
    .references(() => statements.id),
  commitVersion: integer('commit_version')
    .notNull()
    .references(() => memoryCommits.version),
  text: text('text').notNull(),
  arguments: jsonb('arguments')
    .$type<import('../contracts/memory').AssertionProposal['arguments']>()
    .notNull(),
  effectiveDate: text('effective_date'),
  evidence: jsonb('evidence')
    .$type<import('../contracts/memory').Evidence[]>()
    .notNull(),
  entityIds: jsonb('entity_ids').$type<string[]>().notNull(),
  updateBasisQuote: text('update_basis_quote'),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
});
export const statementRelations = pgTable('statement_relations', {
  id: uuid('id').primaryKey(),
  fromVersionId: uuid('from_version_id')
    .notNull()
    .references(() => statementVersions.id),
  toVersionId: uuid('to_version_id')
    .notNull()
    .references(() => statementVersions.id),
  kind: text('kind').$type<'support' | 'supersede' | 'conflict'>().notNull(),
  commitVersion: integer('commit_version')
    .notNull()
    .references(() => memoryCommits.version),
  reason: text('reason').notNull(),
});
export const evidenceAdmissions = pgTable('evidence_admissions', {
  revisionId: uuid('revision_id')
    .primaryKey()
    .references(() => revisions.id),
  uploadId: uuid('upload_id')
    .notNull()
    .references(() => uploads.id),
  commitVersion: integer('commit_version')
    .notNull()
    .references(() => memoryCommits.version),
  sourceTime: text('source_time'),
});
export const knowledgeEvents = pgTable('knowledge_events', {
  id: uuid('id').primaryKey(),
  commitVersion: integer('commit_version')
    .notNull()
    .references(() => memoryCommits.version),
  kind: text('kind').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
});

export const memoryNodes = pgTable('memory_nodes', {
  id: uuid('id').primaryKey(),
  kind: text('kind')
    .$type<import('../contracts/organization').MemoryNode['kind']>()
    .notNull(),
  scopeId: uuid('scope_id'),
  revisionId: uuid('revision_id').references(() => revisions.id),
  createdVersion: integer('created_version')
    .notNull()
    .references(() => memoryCommits.version),
});
export const memoryNodeVersions = pgTable('memory_node_versions', {
  id: uuid('id').primaryKey(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => memoryNodes.id),
  commitVersion: integer('commit_version')
    .notNull()
    .references(() => memoryCommits.version),
  payload: jsonb('payload')
    .$type<
      Omit<import('../contracts/organization').NodeVersion, 'commitVersion'>
    >()
    .notNull(),
});

export const researchRuns = pgTable('research_runs', {
  id: uuid('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  input: jsonb('input')
    .$type<import('../contracts/research').ResearchInput>()
    .notNull(),
  scope: jsonb('scope')
    .$type<import('../contracts/research').ResearchScope>()
    .notNull(),
  state: text('state').notNull().default('queued'),
  progress: text('progress').notNull().default('Waiting for Researcher'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  answer:
    jsonb('answer').$type<import('../contracts/research').ResearchAnswer>(),
  trace: jsonb('trace')
    .$type<import('../contracts/research').ResearchTrace[]>()
    .notNull()
    .default([]),
  usage: jsonb('usage').$type<{
    inputTokens: number;
    outputTokens: number;
    calls: number;
    elapsedMs: number;
  }>(),
  model: text('model'),
  promptVersion: text('prompt_version'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const researchOutbox = pgTable('research_outbox', {
  id: uuid('id')
    .primaryKey()
    .references(() => researchRuns.id),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  createdAt: createdAt(),
});
