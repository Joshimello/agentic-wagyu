import { z } from 'zod';
import { id, type Stage } from './index';
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(new Date(value).getTime()) &&
      new Date(value).toISOString().slice(0, 10) === value,
    'Invalid calendar date',
  );
export const evidenceSchema = z
  .object({ revisionId: id, primitiveId: id, quote: z.string().nullable() })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
const common = {
  ref: z.string().min(1),
  projectRef: z.string().min(1),
  entityRefs: z.array(z.string()),
  text: z.string().min(1).max(2000),
  stateKey: z.string().min(1).max(200),
  evidenceRefs: z.array(z.string()).min(1).max(12),
  effectiveDate: date.nullable(),
  updateBasisQuote: z.string().min(1).nullable(),
};
const variants = [
  z
    .object({
      ...common,
      type: z.literal('ProjectGoal'),
      arguments: z
        .object({
          goal: z.string().min(1),
          successCriteria: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('Decision'),
      arguments: z
        .object({
          decision: z.string().min(1),
          rationale: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('Commitment'),
      arguments: z
        .object({
          task: z.string().min(1),
          owner: z.string().nullable(),
          status: z.enum(['planned', 'in_progress', 'done', 'canceled']),
          dueDate: date.nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('Finding'),
      arguments: z
        .object({
          finding: z.string().min(1),
          conditions: z.string().min(1),
          metric: z.string().nullable(),
          value: z.string().nullable(),
          units: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('Hypothesis'),
      arguments: z.object({ hypothesis: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('ProblemReport'),
      arguments: z
        .object({
          problem: z.string().min(1),
          status: z.enum(['open', 'resolved']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('OpenQuestion'),
      arguments: z
        .object({
          question: z.string().min(1),
          status: z.enum(['open', 'answered']),
        })
        .strict(),
    })
    .strict(),
] as const;
export const assertionSchema = z.discriminatedUnion('type', variants);
export type AssertionProposal = z.infer<typeof assertionSchema>;
export const extractionSchema = z
  .object({
    projects: z
      .array(
        z
          .object({
            ref: z.string().min(1),
            name: z.string().min(1).max(200),
            description: z.string().min(1).max(2000),
            aliases: z.array(z.string().min(1)),
            matchId: id.nullable(),
            matchConfidence: z.number().min(0).max(1),
            matchReason: z.string(),
            evidenceRefs: z.array(z.string()).min(1).max(12),
          })
          .strict(),
      )
      .max(12),
    entities: z
      .array(
        z
          .object({
            ref: z.string().min(1),
            projectRef: z.string().min(1),
            kind: z.enum([
              'person',
              'organization',
              'tool',
              'dataset',
              'activity',
            ]),
            name: z.string().min(1).max(200),
            evidenceRefs: z.array(z.string()).min(1).max(12),
          })
          .strict(),
      )
      .max(30),
    assertions: z.array(assertionSchema).max(16),
    warnings: z.array(z.string()).max(30),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export const projectScope = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }).strict(),
  z.object({ mode: z.literal('existing'), projectId: id }).strict(),
  z
    .object({ mode: z.literal('new'), name: z.string().trim().min(1).max(200) })
    .strict(),
]);
export const pushInput = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    items: z
      .array(
        z
          .object({ uploadId: id, revisionId: id, acceptPartial: z.boolean() })
          .strict(),
      )
      .min(1)
      .max(20),
    projectScope: projectScope.default({ mode: 'auto' }),
  })
  .strict();
export type PushInput = z.infer<typeof pushInput>;
export type Project = {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  createdVersion: number;
  evidence: Evidence[];
  origin: 'model' | 'user';
};
export type Entity = {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  createdVersion: number;
  evidence: Evidence[];
};
export type Statement = {
  id: string;
  projectId: string;
  type: AssertionProposal['type'];
  stateKey: string;
  createdVersion: number;
};
export type StatementVersion = {
  id: string;
  statementId: string;
  commitVersion: number;
  text: string;
  arguments: AssertionProposal['arguments'];
  effectiveDate: string | null;
  evidence: Evidence[];
  entityIds: string[];
  updateBasisQuote: string | null;
  model: string;
  promptVersion: string;
};
export type Relation = {
  id: string;
  fromVersionId: string;
  toVersionId: string;
  kind: 'support' | 'supersede' | 'conflict';
  commitVersion: number;
  reason: string;
};
export type Admission = {
  uploadId: string;
  revisionId: string;
  commitVersion: number;
  sourceTime: string | null;
};
export type Event = {
  id: string;
  commitVersion: number;
  kind: string;
  payload: Record<string, unknown>;
};
export type Snapshot = {
  version: number;
  projects: Project[];
  entities: Entity[];
  statements: Statement[];
  versions: StatementVersion[];
  relations: Relation[];
  admissions: Admission[];
  events: Event[];
  commits: { version: number; createdAt: string; pushId: string | null }[];
};
export type Plan = {
  baseVersion: number;
  model: string;
  promptVersion: string;
  projects: Omit<Project, 'createdVersion'>[];
  entities: Omit<Entity, 'createdVersion'>[];
  statements: Omit<Statement, 'createdVersion'>[];
  versions: Omit<StatementVersion, 'commitVersion'>[];
  relations: Omit<Relation, 'commitVersion'>[];
  outcomes: {
    uploadId: string;
    revisionId: string;
    disposition: 'incorporated' | 'duplicate' | 'no_assertions';
    assertions: number;
    warnings: string[];
  }[];
};
export function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
export function isSpeakerLabel(name: string) {
  return /\bS\d+\b|\b(speaker|presenter|professor|student|participant)\b|說話者|發言者|老師|同學/i.test(
    name,
  );
}
/** Anonymous/role speaker labels identify a source run, not the same person in another meeting. */
export function matchesEntity(
  existing: Pick<Entity, 'projectId' | 'kind' | 'name' | 'evidence'>,
  projectId: string,
  kind: string,
  name: string,
  revisionId: string,
) {
  return (
    existing.projectId === projectId &&
    existing.kind === kind &&
    normalize(existing.name) === normalize(name) &&
    (kind !== 'person' ||
      !isSpeakerLabel(name) ||
      existing.evidence.some((e) => e.revisionId === revisionId))
  );
}
export function stableId(...parts: string[]) {
  const h = new Bun.CryptoHasher('sha256')
    .update(parts.join('\0'))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function validateEvidence(
  evidence: Evidence[],
  stages: Stage[],
  admitted: Set<string>,
) {
  if (!evidence.length) throw new Error('Assertion needs source evidence');
  for (const e of evidence) {
    const stage = stages.find((s) => s.id === e.revisionId);
    const p = stage?.primitives.find((p) => p.id === e.primitiveId);
    if (!stage || !admitted.has(stage.id) || !p)
      throw new Error('Evidence outside pinned source revisions');
    if (e.quote !== null && (p.kind !== 'text' || !p.text.includes(e.quote)))
      throw new Error('Evidence quotation differs from source');
    const skipped = stage.document?.review?.skippedMedia?.some((m) =>
      m.evidenceIds.includes(p.id),
    );
    if (skipped)
      throw new Error('Boilerplate cannot support a research assertion');
  }
}

/** Event dates require confirmed metadata or literal dated text; filename/arrival guesses are insufficient. */
export function hasSupportedDate(
  value: string,
  stages: Stage[],
  evidence: Evidence[],
  metadataAllowed = true,
) {
  return evidence.some((e) => {
    const stage = stages.find((s) => s.id === e.revisionId);
    if (!stage) return false;
    if (
      metadataAllowed &&
      stage.metadata.sourceTimeOrigin !== 'unknown' &&
      stage.metadata.sourceTime?.slice(0, 10) === value
    )
      return true;
    const p = stage.primitives.find((p) => p.id === e.primitiveId);
    const [year, month, day] = value.split('-');
    return (
      p?.kind === 'text' &&
      (p.text.includes(value) ||
        p.text.includes(`${year}年${Number(month)}月${Number(day)}日`))
    );
  });
}
