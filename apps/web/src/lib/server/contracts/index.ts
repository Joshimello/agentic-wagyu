import { z } from 'zod';

export const id = z.string().uuid();
const ms = z.number().int().nonnegative();
export const locator = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('media'),
      timeline: z.literal('container'),
      startMs: ms,
      endMs: ms,
    })
    .strict(),
  z
    .object({ kind: z.literal('page'), page: z.number().int().positive() })
    .strict(),
  z
    .object({ kind: z.literal('slide'), slide: z.number().int().positive() })
    .strict(),
  z.object({ kind: z.literal('text'), start: ms, end: ms }).strict(),
  z
    .object({
      kind: z.literal('image'),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict(),
]);
export const metadata = z
  .object({
    uploader: z.string().min(1),
    uploadedAt: z.string().datetime(),
    sourceTime: z.string().datetime().nullable(),
    label: z.string(),
    sourceTimeOrigin: z.enum(['user', 'file', 'unknown']),
  })
  .strict();
export const textPrimitive = z
  .object({
    id,
    kind: z.literal('text'),
    role: z.enum(['asr', 'native', 'ocr', 'notes']),
    text: z.string(),
    speaker: z.string().nullable(),
    locator,
  })
  .strict();
export const imagePrimitive = z
  .object({
    id,
    kind: z.literal('image'),
    role: z.enum(['frame', 'slide', 'page', 'original']),
    assetId: id,
    requestedMs: ms.nullable(),
    actualMs: ms.nullable(),
    locator,
  })
  .strict();
export const primitive = z.discriminatedUnion('kind', [
  textPrimitive,
  imagePrimitive,
]);
export const annotation = z
  .object({
    id,
    text: z.string().min(1),
    transcriptIds: z.array(id),
    frameIds: z.array(id).min(1),
    origin: z.literal('model'),
    model: z.string(),
    promptVersion: z.string(),
  })
  .strict();
export const stageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    uploadId: id,
    rawAssetId: id,
    parentRevisionId: id.nullable(),
    createdAt: z.string().datetime(),
    metadata,
    primitives: z.array(primitive),
    annotations: z.array(annotation),
    coverage: z
      .object({
        complete: z.boolean(),
        durationMs: ms.nullable(),
        warnings: z.array(z.string()),
      })
      .strict(),
    provenance: z
      .object({
        adapter: z.string(),
        model: z.string().nullable(),
        modelRevision: z.string().nullable(),
        promptVersion: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
export type Stage = z.infer<typeof stageSchema>;
export type Primitive = z.infer<typeof primitive>;

/** Validate foreign references and timeline semantics after structural parsing. */
export function validateStage(value: unknown): Stage {
  const stage = stageSchema.parse(value);
  const byId = new Map(stage.primitives.map((p) => [p.id, p]));
  if (byId.size !== stage.primitives.length)
    throw new Error('Duplicate primitive ID');
  const duration = stage.coverage.durationMs;
  for (const p of stage.primitives) {
    if ('startMs' in p.locator) {
      if (
        p.locator.endMs < p.locator.startMs ||
        duration === null ||
        p.locator.endMs > duration
      )
        throw new Error('Invalid media interval');
    }
    if ('start' in p.locator && p.locator.end < p.locator.start)
      throw new Error('Invalid character interval');
    if (p.kind === 'image' && p.role === 'frame') {
      if (
        p.actualMs === null ||
        p.requestedMs === null ||
        duration === null ||
        p.actualMs >= duration ||
        p.requestedMs >= duration
      )
        throw new Error('Invalid frame timestamp');
      if (
        p.locator.kind !== 'media' ||
        p.locator.startMs !== p.actualMs ||
        p.locator.endMs !== p.actualMs
      )
        throw new Error('Frame locator must record actual container timestamp');
    }
  }
  if (
    new Set(stage.annotations.map((a) => a.id)).size !==
    stage.annotations.length
  )
    throw new Error('Duplicate annotation ID');
  for (const a of stage.annotations) {
    if (
      a.frameIds.some((ref) => byId.get(ref)?.kind !== 'image') ||
      a.transcriptIds.some((ref) => byId.get(ref)?.kind !== 'text')
    )
      throw new Error('Annotation references missing or wrong primitive');
  }
  if (!stage.coverage.complete && stage.coverage.warnings.length === 0)
    throw new Error('Incomplete coverage must be explained');
  return stage;
}

export const runStates = [
  'queued',
  'processing',
  'ready',
  'ready_with_warnings',
  'failed',
  'canceled',
] as const;
export type RunState = (typeof runStates)[number];
const transitions: Record<RunState, readonly RunState[]> = {
  queued: ['processing', 'canceled'],
  processing: ['ready', 'ready_with_warnings', 'failed', 'canceled'],
  ready: [],
  ready_with_warnings: [],
  failed: ['queued'],
  canceled: ['queued'],
};
export function transition(from: RunState, to: RunState) {
  if (!transitions[from].includes(to))
    throw new Error(`Invalid transition ${from} -> ${to}`);
  return to;
}
export const pushSchema = z
  .object({
    id,
    idempotencyKey: z.string().min(1),
    createdAt: z.string().datetime(),
    expectedMemoryVersion: ms,
    items: z
      .array(
        z
          .object({ uploadId: id, revisionId: id, acceptPartial: z.boolean() })
          .strict(),
      )
      .min(1),
  })
  .strict();
export function validatePush(value: unknown, revisions: Stage[]) {
  const push = pushSchema.parse(value);
  if (new Set(push.items.map((i) => i.uploadId)).size !== push.items.length)
    throw new Error('Duplicate upload selection');
  for (const item of push.items) {
    const rev = revisions.find(
      (r) => r.id === item.revisionId && r.uploadId === item.uploadId,
    );
    if (!rev || (!rev.coverage.complete && !item.acceptPartial))
      throw new Error('Push must pin an available accepted revision');
  }
  return push;
}
export const memorySchema = z
  .object({
    version: z.number().int().positive(),
    pushId: id,
    committedAt: z.string().datetime(),
    assertions: z.array(
      z
        .object({
          id,
          text: z.string().min(1),
          effectiveAt: z.string().datetime().nullable(),
          evidence: z
            .array(z.object({ revisionId: id, primitiveId: id }).strict())
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();
export const querySchema = z
  .object({
    question: z.string().min(1),
    memoryVersion: ms,
    effectiveAt: z.string().datetime().nullable(),
    knownAt: z.string().datetime(),
  })
  .strict();
export function assertReadScope(
  snapshotVersion: number,
  commitVersion: number,
  revisionId: string,
  admittedRevisions: ReadonlySet<string>,
) {
  if (commitVersion > snapshotVersion || !admittedRevisions.has(revisionId))
    throw new Error('Evidence outside committed query snapshot');
}
