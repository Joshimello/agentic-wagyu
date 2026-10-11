import { z } from 'zod';
import { id, locator } from './index';
export const researchInput = z
  .object({
    question: z.string().trim().min(1).max(4000),
    idempotencyKey: z.string().min(1).max(200),
    projectId: id.optional(),
    knownVersion: z.number().int().nonnegative().optional(),
    knownAt: z.string().datetime().optional(),
    effectiveAt: z.string().date().optional(),
  })
  .strict();
export type ResearchInput = z.infer<typeof researchInput>;
export const answerProposal = z
  .object({
    status: z.enum(['answered', 'partial', 'insufficient_evidence']),
    claims: z
      .array(
        z
          .object({
            text: z.string().min(1).max(2400),
            basis: z.enum(['source', 'inference', 'conflict']),
            citations: z.array(z.string().min(1).max(180)).min(1).max(8),
          })
          .strict(),
      )
      .max(20),
    limitations: z.array(z.string().min(1).max(1200)).max(12),
  })
  .strict();
export type AnswerProposal = z.infer<typeof answerProposal>;
export type ResearchScope = {
  version: number;
  projectId?: string;
  effectiveAt?: string;
};
export type Citation = {
  id: string;
  revisionId: string;
  primitiveId: string;
  nodeId: string;
  nodeVersionId: string;
  filename: string;
  locator: z.infer<typeof locator>;
  kind: 'text' | 'image';
  quote?: string;
  first?: number;
  last?: number;
  url: string;
  historical: boolean;
};
export type ResearchAnswer = AnswerProposal & {
  citations: Citation[];
  snapshot: ResearchScope;
  warnings: string[];
};
export type ResearchTrace = {
  tool: string;
  arguments: unknown;
  result: unknown;
};
export const researchPromptVersion = 'researcher-1-en';
export const researchLimits = {
  rounds: 10,
  calls: 24,
  textCharacters: 42000,
  images: 6,
  imageBytes: 12000000,
  candidates: 20,
} as const;
