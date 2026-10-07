import { z } from 'zod';
import { id } from './index';

export const nodeKind = z.enum(['project', 'topic', 'source', 'segment']);
export const nodeIdentity = z
  .object({
    id,
    kind: nodeKind,
    scopeId: id.nullable(),
    revisionId: id.nullable(),
  })
  .strict();
export const nodeVersion = z
  .object({
    id,
    nodeId: id,
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(6000),
    keywords: z.array(z.string().min(1).max(100)).max(20),
    children: z
      .array(z.object({ nodeId: id, versionId: id }).strict())
      .max(10000),
    segment: z
      .object({
        revisionId: id,
        firstUnit: z.number().int().nonnegative(),
        lastUnit: z.number().int().nonnegative(),
        unitSchemaVersion: z.literal(1),
        contextOnly: z.boolean(),
      })
      .strict()
      .nullable(),
    warnings: z.array(z.string()).max(100),
    model: z.string(),
    promptVersion: z.string(),
  })
  .strict();
export const organizationPlan = z
  .object({ nodes: z.array(nodeIdentity), versions: z.array(nodeVersion) })
  .strict();
export type OrganizationPlan = z.infer<typeof organizationPlan>;
export type MemoryNode = z.infer<typeof nodeIdentity> & {
  createdVersion: number;
};
export type NodeVersion = z.infer<typeof nodeVersion> & {
  commitVersion: number;
};
export type OrganizationSnapshot = {
  version: number;
  nodes: MemoryNode[];
  versions: NodeVersion[];
  admissions: {
    uploadId: string;
    revisionId: string;
    commitVersion: number;
    sourceTime: string | null;
  }[];
  commits: { version: number; createdAt: string; pushId: string | null }[];
};

const match = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000),
    matchId: id.nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  })
  .strict();
export const segmentResponse = z
  .object({
    segments: z
      .array(
        z
          .object({
            firstUnit: z.number().int().nonnegative(),
            lastUnit: z.number().int().nonnegative(),
            title: z.string().min(1).max(200),
            summary: z.string().min(1).max(3000),
            keywords: z.array(z.string().min(1).max(100)).max(12),
            contextOnly: z.boolean(),
            project: match.nullable(),
            topic: match.nullable(),
            continuesPrevious: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    warnings: z.array(z.string()).max(30),
  })
  .strict();
export const overviewResponse = z
  .object({
    summary: z.string().min(1).max(6000),
    keywords: z.array(z.string().min(1).max(100)).max(20),
    warnings: z.array(z.string()).max(30),
  })
  .strict();
export function validatePartition(
  ranges: { firstUnit: number; lastUnit: number }[],
  first: number,
  last: number,
) {
  let cursor = first;
  for (const range of ranges) {
    if (
      range.firstUnit !== cursor ||
      range.lastUnit < cursor ||
      range.lastUnit > last
    )
      throw new Error(
        'Segments must cover every supplied unit in order without gaps or overlaps',
      );
    cursor = range.lastUnit + 1;
  }
  if (cursor !== last + 1) throw new Error('Source coverage is incomplete');
}

export const scopeResponse = z
  .object({
    assignments: z
      .array(
        z
          .object({
            segmentId: id,
            project: match.nullable(),
            topic: match.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    warnings: z.array(z.string()).max(30),
  })
  .strict();
