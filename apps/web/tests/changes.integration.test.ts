import { test, expect, afterAll } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { db, sqlClient } from '../src/lib/server/db/client';
import {
  approvedItemVersions,
  changeReviewEvents,
  comparisonJobs,
  changeProposals,
  researchRuns,
  runs,
  revisions,
} from '../src/lib/server/db/schema';
import {
  createComparison,
  getComparison,
  reviewChange,
  approvedHistory,
  reviewHistoryVersion,
  changeComparison,
  comparisonChoices,
} from '../src/lib/server/services/changes';
import {
  createResearch,
  loadResearchCorpus,
} from '../src/lib/server/services/research';
import { correctStage } from '../src/lib/server/services/staging';
import { getUpload, retryUpload } from '../src/lib/server/services/uploads';
import { interpret } from '../src/lib/server/agents/interpreter';
import { compare } from '../src/lib/server/agents/changes';
import { recoverInterrupted } from '../src/lib/server/jobs/operation';
import { dispatchComparisons, startQueue } from '../src/lib/server/jobs/queue';
import {
  meeting,
  admit,
  completedComparison,
  proposal,
  comparisonProvider,
} from './support/changes-fixtures';
import type { Stage } from '../src/lib/server/contracts';
const enabled = process.env.TEST_SUITE === 'changes',
  check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
let earlier: Stage, later: Stage, projectId: string;
const reviewInput = (action = 'approve') => ({
  idempotencyKey: crypto.randomUUID(),
  action,
  reason: 'Reviewed against both original meeting statements.',
});
async function firstProposal(jobId: string) {
  return (await getComparison(jobId)).proposals[0];
}

check(
  'comparison pins accepted project membership, original evidence, unknown dates and idempotency',
  async () => {
    earlier = await meeting(
      'We plan to run the calibration test.',
      'earlier-unknown.mp4',
    );
    projectId = (await admit(earlier)).projectId;
    later = await meeting(
      'The calibration test is complete.',
      'later-unknown.mp4',
    );
    await admit(later, projectId);
    const other = await meeting(
      'Unrelated project uses a secret alternate camera.',
    );
    await admit(other);
    const unpushed = await meeting('Unpushed transcript must remain excluded.');
    const input = {
      projectId,
      earlierRevisionId: earlier.id,
      laterRevisionId: later.id,
      idempotencyKey: crypto.randomUUID(),
    };
    const job = await createComparison(input);
    expect((await createComparison(input)).id).toBe(job.id);
    expect(job.scope.earlier.date).toBeNull();
    expect(job.scope.later.date).toBeNull();
    expect(job.scope.evidence.map((c) => c.revisionId)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(
      (await comparisonChoices()).projects
        .find((p) => p.id === projectId)!
        .meetings.map((m) => m.revisionId),
    ).toEqual([earlier.id, later.id]);
    for (const laterRevisionId of [earlier.id, other.id, unpushed.id])
      await expect(
        createComparison({
          ...input,
          laterRevisionId,
          idempotencyKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow();
    await expect(
      createComparison({ ...input, laterRevisionId: other.id }),
    ).rejects.toThrow('Idempotency');
    const p = proposal(job.scope);
    expect(p.value.owner).toBeNull();
    expect(p.value.deadline).toBeNull();
    const provider = comparisonProvider(job.scope, p);
    await compare(job.id, 0, { llm: provider.llm });
    expect((await getComparison(job.id)).job.state).toBe('completed');
    expect((await getComparison(job.id)).job.warnings.join(' ')).toContain(
      'unknown',
    );
  },
);
check(
  'unsupported quotations fail without publishing proposals; cancel, retry, generations and recovery preserve scope',
  async () => {
    const job = await createComparison({
      projectId,
      earlierRevisionId: earlier.id,
      laterRevisionId: later.id,
      idempotencyKey: crypto.randomUUID(),
    });
    const invalid = comparisonProvider(job.scope, proposal(job.scope), {
      invalid: true,
    });
    await expect(compare(job.id, 0, { llm: invalid.llm })).rejects.toThrow();
    expect((await getComparison(job.id)).proposals).toEqual([]);
    await changeComparison(job.id, 'cancel', 0);
    await changeComparison(job.id, 'retry', 0);
    await expect(changeComparison(job.id, 'cancel', 0)).rejects.toThrow(
      'changed',
    );
    await compare(job.id, 0, { llm: comparisonProvider(job.scope).llm });
    expect((await getComparison(job.id)).job.state).toBe('queued');
    const during = comparisonProvider(job.scope, proposal(job.scope), {
      afterRead: async () => {
        await changeComparison(job.id, 'cancel', 1);
      },
    });
    await compare(job.id, 1, { llm: during.llm });
    expect((await getComparison(job.id)).job.state).toBe('canceled');
    expect((await getComparison(job.id)).proposals).toEqual([]);
    await changeComparison(job.id, 'retry', 1);
    await db
      .update(comparisonJobs)
      .set({ state: 'processing' })
      .where(eq(comparisonJobs.id, job.id));
    expect(await recoverInterrupted(['comparison'])).toBe(1);
    const recovered = (await getComparison(job.id)).job;
    expect(recovered.scope).toEqual(job.scope);
    expect(recovered.generation).toBe(3);
    const boss = await startQueue();
    try {
      await dispatchComparisons(boss);
      const deliveries =
        await sqlClient`select data from pgboss.job where name='comparison' and data->>'runId'=${job.id}`;
      expect(deliveries.at(-1)?.data.generation).toBe(3);
    } finally {
      await boss.stop();
    }
  },
);
check(
  'approval is idempotent, rejection is excluded, edits identify reviewer additions and saved Ask scopes stay frozen',
  async () => {
    const job = await completedComparison(
      projectId,
      earlier,
      later,
      'ask-calibration',
    );
    const p = await firstProposal(job.id);
    const before = await createResearch({
      question: 'What is current calibration progress?',
      projectId,
      idempotencyKey: crypto.randomUUID(),
    });
    const beforeCorpus = await loadResearchCorpus(before.scope);
    expect(beforeCorpus.approvedState().items).toEqual([]);
    const input = {
      ...reviewInput('edit'),
      value: { ...p.proposal.value, owner: 'Reviewer supplied owner' },
    };
    const event = await reviewChange(p.id, input);
    expect((await reviewChange(p.id, input)).id).toBe(event.id);
    const nextMeeting = await meeting(
      'We plan an additional calibration analysis.',
    );
    const afterApprovalCommit = await admit(nextMeeting, projectId);
    await expect(
      reviewChange(p.id, { ...input, reason: 'Changed action' }),
    ).rejects.toThrow(/idempotency/i);
    const after = await createResearch({
      question: 'What is current calibration progress?',
      projectId,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(after.scope.reviewVersion).toBeGreaterThan(
      before.scope.reviewVersion!,
    );
    const corpus = await loadResearchCorpus(after.scope),
      items = corpus.approvedState().items;
    expect(items.at(-1)?.reviewerAdded).toContain('owner');
    const answer = corpus.validate({
      status: 'answered',
      claims: [
        {
          text: 'The reviewer assigned the calibration owner.',
          basis: 'reviewed',
          citations: [],
          reviewRefs: [items.at(-1)!.reviewRef],
        },
      ],
      limitations: [],
    });
    expect(answer.reviewReferences?.at(-1)?.eventId).toBe(event.id);
    expect(
      answer.reviewReferences?.at(-1)?.evidence.map((c) => c.revisionId),
    ).toEqual([earlier.id, later.id]);
    expect(
      (await loadResearchCorpus(before.scope)).approvedState().items,
    ).toEqual([]);
    await db
      .update(researchRuns)
      .set({ answer, state: 'completed' })
      .where(eq(researchRuns.id, after.id));
    const rejectedJob = await completedComparison(
      projectId,
      earlier,
      later,
      'rejected-calibration',
    );
    const rejected = await firstProposal(rejectedJob.id);
    await reviewChange(rejected.id, reviewInput('reject'));
    const newest = await createResearch({
      question: 'Current commitments',
      projectId,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (await loadResearchCorpus(newest.scope))
        .approvedState()
        .items.some((i) => i.value.stateKey === 'rejected-calibration'),
    ).toBe(false);
    expect(
      (
        await db
          .select()
          .from(researchRuns)
          .where(eq(researchRuns.id, after.id))
      )[0].answer,
    ).toEqual(answer);
    const historical = await createResearch({
      question: 'Historical state',
      projectId,
      knownVersion: job.scope.memoryVersion,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(historical.scope.reviewVersion).toBe(0);
    const knownAt = await createResearch({
      question: 'Before review',
      projectId,
      knownAt: new Date(event.createdAt.getTime() - 1).toISOString(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      (await loadResearchCorpus(knownAt.scope)).approvedState().items,
    ).toEqual([]);
    const atCommit = await createResearch({
      question: 'State at the next memory commit',
      projectId,
      knownVersion: afterApprovalCommit.version,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(atCommit.scope.reviewVersion).toBe(event.reviewVersion);
    const oldCorpus = await loadResearchCorpus({
      version: after.scope.version,
      projectId,
    });
    expect(oldCorpus.approvedState().items).toEqual([]);
  },
);
check(
  'completion verification requires an explicit action, criteria and evidence',
  async () => {
    const job = await completedComparison(
        projectId,
        earlier,
        later,
        'verification-calibration',
      ),
      p = await firstProposal(job.id);
    const verified = {
      ...p.proposal.value,
      status: 'completion_verified' as const,
    };
    await expect(
      reviewChange(p.id, { ...reviewInput('edit'), value: verified }),
    ).rejects.toThrow('Verification');
    await expect(
      reviewChange(p.id, {
        ...reviewInput('edit'),
        value: verified,
        verifyCompletion: true,
      }),
    ).rejects.toThrow('Verification');
    await expect(
      reviewChange(p.id, {
        ...reviewInput('edit'),
        value: {
          ...verified,
          completionCriteria: 'All calibration cases pass.',
        },
        verifyCompletion: true,
        evidenceIds: [],
      }),
    ).rejects.toThrow();
    await reviewChange(p.id, {
      ...reviewInput('edit'),
      value: { ...verified, completionCriteria: 'All calibration cases pass.' },
      verifyCompletion: true,
    });
    const approved = (
      await approvedHistory(await reviewHistoryVersion(), projectId)
    ).at(-1)!;
    expect(approved.value.status).toBe('completion_verified');
    expect(approved.reviewerAdded).toContain('completionCriteria');
  },
);
check(
  'simultaneous approvals have one effect and competing proposals cannot overwrite target history',
  async () => {
    const a = await completedComparison(
        projectId,
        earlier,
        later,
        'racing-calibration',
      ),
      b = await completedComparison(
        projectId,
        earlier,
        later,
        'racing-calibration',
      );
    const pa = await firstProposal(a.id),
      pb = await firstProposal(b.id),
      input = reviewInput();
    const same = await Promise.all([
      reviewChange(pa.id, input),
      reviewChange(pa.id, input),
    ]);
    expect(same[0].id).toBe(same[1].id);
    await expect(reviewChange(pb.id, reviewInput())).rejects.toThrow(
      'state changed',
    );
    const previous = (
      await approvedHistory(await reviewHistoryVersion(), projectId)
    ).at(-1)!;
    const c = await completedComparison(
        projectId,
        earlier,
        later,
        'racing-calibration',
        previous.itemId,
      ),
      d = await completedComparison(
        projectId,
        earlier,
        later,
        'racing-calibration',
        previous.itemId,
      );
    const pc = await firstProposal(c.id),
      pd = await firstProposal(d.id);
    const race = await Promise.allSettled([
      reviewChange(pc.id, reviewInput()),
      reviewChange(pd.id, reviewInput()),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const history = (
      await approvedHistory(await reviewHistoryVersion(), projectId)
    ).filter((v) => v.itemId === previous.itemId);
    expect(history).toHaveLength(2);
    expect(history[1].previousVersionId).toBe(previous.id);
  },
);
check(
  'unpushed corrections preserve admission eligibility; later admission rejects stale selected evidence',
  async () => {
    const valid = await completedComparison(
        projectId,
        earlier,
        later,
        'unpushed-safe',
      ),
      stale = await completedComparison(
        projectId,
        earlier,
        later,
        'stale-evidence',
      );
    const corrected = await correctStage(later.uploadId, {
      baseRevisionId: later.id,
      label: later.metadata.label,
      sourceTime: null,
      edits: [
        {
          primitiveId: later.primitives[0].id,
          text: 'The test is still incomplete.',
          speaker: 'S01@window-1',
        },
      ],
    });
    await reviewChange((await firstProposal(valid.id)).id, reviewInput());
    await admit(corrected, projectId);
    await expect(
      reviewChange((await firstProposal(stale.id)).id, reviewInput()),
    ).rejects.toThrow('superseded');
    expect((await getComparison(stale.id)).proposals[0].review).toBeNull();
    expect(
      (await approvedHistory(await reviewHistoryVersion(), projectId)).some(
        (v) => v.value.stateKey === 'unpushed-safe',
      ),
    ).toBe(true);
  },
);
check(
  'persisted speaker-only revisits preserve corrected speech, visuals and reviews without ASR',
  async () => {
    const stage = await meeting(
      'My name is Ada. The transcript must stay unchanged.',
    );
    const corrected = await correctStage(stage.uploadId, {
      baseRevisionId: stage.id,
      label: stage.metadata.label,
      sourceTime: null,
      edits: [
        {
          primitiveId: stage.primitives[0].id,
          text: 'Manually corrected words.',
          speaker: 'Ada',
        },
      ],
    });
    const frameId = crypto.randomUUID();
    corrected.primitives.push({
      id: frameId,
      kind: 'image',
      role: 'frame',
      assetId: corrected.rawAssetId,
      requestedMs: 1500,
      actualMs: 1500,
      locator: {
        kind: 'media',
        timeline: 'container',
        startMs: 1500,
        endMs: 1500,
      },
    });
    corrected.annotations.push({
      id: crypto.randomUUID(),
      text: 'The slide shows the calibration workflow.',
      transcriptIds: [corrected.primitives[0].id],
      frameIds: [frameId],
      origin: 'model',
      model: 'regression',
      promptVersion: 'regression',
    });
    corrected.speakerSuggestions = [
      {
        id: crypto.randomUUID(),
        speaker: 'S01@window-1',
        candidateName: 'Ada',
        confidence: 'high',
        basis: 'self_introduction',
        reason: 'Previously reviewed.',
        transcriptIds: [corrected.primitives[0].id],
        voiceTranscriptIds: [corrected.primitives[0].id],
        frameIds: [frameId],
        model: 'regression',
        promptVersion: 'regression',
        review: 'confirmed',
      },
    ];
    await db
      .update(revisions)
      .set({ manifest: corrected })
      .where(eq(revisions.id, corrected.id));
    const runId = await retryUpload(stage.uploadId, corrected.id, 'speakers');
    expect(
      (await db.select().from(runs).where(eq(runs.id, runId)))[0],
    ).toMatchObject({ reviewMode: 'speakers', inputRevisionId: corrected.id });
    let asr = 0;
    await interpret(runId, {
      buildVideo: async () => {
        asr++;
        throw new Error('ASR is forbidden for speaker-only review');
      },
    });
    expect(asr).toBe(0);
    const revised = (await getUpload(stage.uploadId)).revisions[0].manifest;
    expect(revised.primitives).toEqual(corrected.primitives);
    expect(revised.annotations).toEqual(corrected.annotations);
    expect(revised.speakerSuggestions).toEqual(corrected.speakerSuggestions);
    expect(revised.parentRevisionId).toBe(corrected.id);
    expect(revised.provenance.adapter).toBe('video-speaker-revisit-1');
    expect(revised.coverage.warnings.join(' ')).toContain('Speaker identity');
    await expect(
      retryUpload(stage.uploadId, undefined, 'speakers'),
    ).rejects.toThrow('pinned');
    await expect(
      retryUpload(stage.uploadId, stage.id, 'speakers'),
    ).rejects.toThrow('Staging changed');
  },
);

check(
  'superseded baseline support rejects approval even when both selected meetings remain active',
  async () => {
    const a = await meeting('We plan a second calibration experiment.'),
      project = (await admit(a)).projectId;
    const b = await meeting('The second calibration experiment is complete.');
    await admit(b, project);
    const first = await completedComparison(
      project,
      a,
      b,
      'baseline-experiment',
    );
    await reviewChange((await firstProposal(first.id)).id, reviewInput());
    const c = await meeting('We plan a follow-up calibration experiment.');
    await admit(c, project);
    const d = await meeting(
      'The follow-up calibration experiment is complete.',
    );
    await admit(d, project);
    const next = await completedComparison(
        project,
        c,
        d,
        'follow-up-experiment',
      ),
      p = await firstProposal(next.id);
    const support = next.scope.evidence.find((c) => c.revisionId === a.id)!;
    const corrected = await correctStage(a.uploadId, {
      baseRevisionId: a.id,
      label: a.metadata.label,
      sourceTime: null,
      edits: [
        {
          primitiveId: a.primitives[0].id,
          text: 'We withdrew the second calibration experiment.',
          speaker: 'S01@window-1',
        },
      ],
    });
    await admit(corrected, project);
    await expect(
      reviewChange(p.id, {
        ...reviewInput('edit'),
        value: p.proposal.value,
        evidenceIds: [...p.proposal.laterCitations, support.id],
      }),
    ).rejects.toThrow('superseded');
  },
);

check(
  'carried-forward reviewer additions keep their provenance in later approved versions and Ask',
  async () => {
    const a = await meeting('We plan an owner-provenance calibration test.'),
      project = (await admit(a)).projectId;
    const b = await meeting(
      'The owner-provenance calibration test is complete.',
    );
    await admit(b, project);
    const first = await completedComparison(project, a, b, 'provenance-test'),
      p = await firstProposal(first.id);
    await reviewChange(p.id, {
      ...reviewInput('edit'),
      value: { ...p.proposal.value, owner: 'Reviewer supplied owner' },
    });
    const previous = (
      await approvedHistory(await reviewHistoryVersion(), project)
    ).at(-1)!;
    const next = await createComparison({
      projectId: project,
      earlierRevisionId: a.id,
      laterRevisionId: b.id,
      idempotencyKey: crypto.randomUUID(),
    });
    const carried = {
      ...proposal(next.scope, 'provenance-test', previous.itemId),
      value: { ...previous.value, status: 'in_progress' as const },
    };
    await compare(next.id, 0, {
      llm: comparisonProvider(next.scope, carried).llm,
    });
    await reviewChange((await firstProposal(next.id)).id, reviewInput());
    const question = await createResearch({
      question: 'Who owns the test?',
      projectId: project,
      idempotencyKey: crypto.randomUUID(),
    });
    const item = (await loadResearchCorpus(question.scope)).approvedState()
      .items[0];
    expect(item.value.owner).toBe('Reviewer supplied owner');
    expect(item.reviewerAdded).toContain('owner');
  },
);
