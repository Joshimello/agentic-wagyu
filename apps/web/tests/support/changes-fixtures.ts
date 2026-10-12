import { eq } from 'drizzle-orm';
import type { Stage } from '../../src/lib/server/contracts';
import { db } from '../../src/lib/server/db/client';
import {
  memoryCommits,
  evidenceAdmissions,
  memoryNodes,
  memoryNodeVersions,
} from '../../src/lib/server/db/schema';
import { acceptUpload, getUpload } from '../../src/lib/server/services/uploads';
import { interpret } from '../../src/lib/server/agents/interpreter';
import {
  organizationSnapshot,
  reduceOrganization,
} from '../../src/lib/server/services/organization';
import {
  createComparison,
  reviewHistoryVersion,
} from '../../src/lib/server/services/changes';
import { compare } from '../../src/lib/server/agents/changes';
import type { llmClient } from '../../src/lib/server/llm/client';
import type {
  ComparisonScope,
  ChangeProposal,
} from '../../src/lib/server/contracts/changes';

export async function meeting(text: string, filename = 'meeting.mp4') {
  const accepted = await acceptUpload(
    new File([text], filename, { type: 'video/mp4' }),
    { groupHint: 'Untrusted staging folder' },
  );
  await interpret(accepted.runId, {
    buildVideo: async (stage) => {
      stage.primitives = [
        {
          id: crypto.randomUUID(),
          kind: 'text',
          role: 'asr',
          text,
          speaker: 'S01@window-1',
          locator: {
            kind: 'media',
            timeline: 'container',
            startMs: 1000,
            endMs: 4000,
          },
        },
      ];
      stage.coverage.durationMs = 10000;
      return stage;
    },
  });
  return (await getUpload(accepted.uploadId)).revisions[0].manifest;
}
export async function admit(
  stage: Stage,
  projectId: string = crypto.randomUUID(),
) {
  const snapshot = await organizationSnapshot(),
    view = reduceOrganization(snapshot),
    version = snapshot.version + 1;
  const sourceId = crypto.randomUUID(),
    segmentId = crypto.randomUUID(),
    sourceVersion = crypto.randomUUID(),
    segmentVersion = crypto.randomUUID(),
    projectVersion = crypto.randomUUID();
  const root = view.all.find((n) => n.id === projectId);
  const payload = (
    id: string,
    nodeId: string,
    title: string,
    children: { nodeId: string; versionId: string }[],
    segment: null | {
      revisionId: string;
      firstUnit: number;
      lastUnit: number;
      unitSchemaVersion: 1;
      contextOnly: boolean;
    } = null,
  ) => ({
    id,
    nodeId,
    title,
    summary: 'Regression project summary',
    keywords: ['calibration'],
    children,
    segment,
    warnings: [],
    model: 'regression',
    promptVersion: 'regression',
  });
  await db.transaction(async (tx) => {
    await tx
      .insert(memoryCommits)
      .values({
        id: crypto.randomUUID(),
        version,
        reviewVersion: await reviewHistoryVersion(undefined, tx),
      });
    await tx.insert(evidenceAdmissions).values({
      revisionId: stage.id,
      uploadId: stage.uploadId,
      commitVersion: version,
      sourceTime: stage.metadata.sourceTime,
    });
    if (!root)
      await tx.insert(memoryNodes).values({
        id: projectId,
        kind: 'project',
        scopeId: null,
        revisionId: null,
        createdVersion: version,
      });
    await tx.insert(memoryNodes).values([
      {
        id: sourceId,
        kind: 'source',
        scopeId: null,
        revisionId: stage.id,
        createdVersion: version,
      },
      {
        id: segmentId,
        kind: 'segment',
        scopeId: sourceId,
        revisionId: stage.id,
        createdVersion: version,
      },
    ]);
    await tx.insert(memoryNodeVersions).values([
      {
        id: projectVersion,
        nodeId: projectId,
        commitVersion: version,
        payload: payload(projectVersion, projectId, 'Calibration project', [
          ...(root?.current.children ?? []),
          { nodeId: segmentId, versionId: segmentVersion },
        ]),
      },
      {
        id: sourceVersion,
        nodeId: sourceId,
        commitVersion: version,
        payload: payload(sourceVersion, sourceId, stage.metadata.label, [
          { nodeId: segmentId, versionId: segmentVersion },
        ]),
      },
      {
        id: segmentVersion,
        nodeId: segmentId,
        commitVersion: version,
        payload: payload(
          segmentVersion,
          segmentId,
          'Calibration decision evidence',
          [],
          {
            revisionId: stage.id,
            firstUnit: 0,
            lastUnit: 0,
            unitSchemaVersion: 1,
            contextOnly: false,
          },
        ),
      },
    ]);
  });
  return { projectId, version, segmentId };
}
export function proposal(
  scope: ComparisonScope,
  key = 'calibration-test',
  targetItemId: string | null = null,
): ChangeProposal {
  const before = scope.evidence.find(
      (c) => c.revisionId === scope.earlier.revisionId,
    )!,
    after = scope.evidence.find(
      (c) => c.revisionId === scope.later.revisionId,
    )!;
  return {
    targetItemId,
    earlier: before.quote!,
    earlierCitations: [before.id],
    laterCitations: [after.id],
    evidenceQuotes: [
      { citationId: before.id, quote: before.quote! },
      { citationId: after.id, quote: after.quote! },
    ],
    value: {
      kind: 'commitment',
      stateKey: key,
      text: 'The calibration test was reported complete.',
      status: 'completion_claimed',
      owner: null,
      deadline: null,
      completionCriteria: null,
    },
    rationale: 'Later meeting reports progress on the earlier plan.',
    uncertainty: ['Completion is reported, not verified.'],
    missingInformation: ['Owner, deadline and criteria are unknown.'],
  };
}
export function comparisonProvider(
  scope: ComparisonScope,
  value = proposal(scope),
  options: { afterRead?: () => Promise<void>; invalid?: boolean } = {},
) {
  let calls = 0;
  const llm = {
    model: 'regression',
    client: {
      chat: {
        completions: {
          create: async () => {
            calls++;
            if (calls === 1) await options.afterRead?.();
            const content =
              calls === 1
                ? {
                    reports: scope.evidence.map((c) => ({
                      kind: 'commitment',
                      text: c.quote,
                      evidence: [{ citationId: c.id, quote: c.quote }],
                      uncertainty: '',
                    })),
                  }
                : {
                    proposals: [
                      options.invalid
                        ? {
                            ...value,
                            evidenceQuotes: [
                              {
                                citationId: value.laterCitations[0],
                                quote: 'This statement never appeared.',
                              },
                            ],
                          }
                        : value,
                    ],
                    warnings: [],
                  };
            return {
              choices: [
                {
                  message: { content: JSON.stringify(content) },
                  finish_reason: 'stop',
                },
              ],
            };
          },
        },
      },
    },
  } as unknown as ReturnType<typeof llmClient>;
  return { llm, calls: () => calls };
}
export async function completedComparison(
  projectId: string,
  earlier: Stage,
  later: Stage,
  key = 'calibration-test',
  targetItemId: string | null = null,
) {
  const job = await createComparison({
    projectId,
    earlierRevisionId: earlier.id,
    laterRevisionId: later.id,
    idempotencyKey: crypto.randomUUID(),
  });
  const provider = comparisonProvider(
    job.scope,
    proposal(job.scope, key, targetItemId),
  );
  await compare(job.id, job.generation, { llm: provider.llm });
  return job;
}
