import { test, expect } from 'bun:test';
import {
  validateProposal,
  validateApproval,
  proposalEvidence,
  comparisonInput,
  changeProposal,
  type ComparisonScope,
} from '../src/lib/server/contracts/changes';
import type { Citation } from '../src/lib/server/contracts/research';
function fixture() {
  const earlier = crypto.randomUUID(),
    later = crypto.randomUUID();
  const citation = (
    id: string,
    revisionId: string,
    quote: string,
  ): Citation => ({
    id,
    revisionId,
    primitiveId: crypto.randomUUID(),
    nodeId: crypto.randomUUID(),
    nodeVersionId: crypto.randomUUID(),
    filename: 'meeting.mp4',
    kind: 'text',
    locator: {
      kind: 'media',
      timeline: 'container',
      startMs: 1000,
      endMs: 4000,
    },
    quote,
    first: 20,
    last: 20 + quote.length,
    url: '/evidence',
    historical: false,
  });
  const scope: ComparisonScope = {
    memoryVersion: 2,
    reviewVersion: 0,
    projectId: crypto.randomUUID(),
    earlier: {
      revisionId: earlier,
      uploadId: crypto.randomUUID(),
      filename: 'earlier.mp4',
      date: null,
    },
    later: {
      revisionId: later,
      uploadId: crypto.randomUUID(),
      filename: 'later.mp4',
      date: null,
    },
    baseline: [],
    evidence: [
      citation(
        'C1',
        earlier,
        'Before this: We plan to run calibration. More context.',
      ),
      citation(
        'C2',
        later,
        'Later report: Calibration is complete. More context.',
      ),
    ],
  };
  const proposal = changeProposal.parse({
    targetItemId: null,
    earlier: 'Calibration was planned.',
    earlierCitations: ['C1'],
    laterCitations: ['C2'],
    evidenceQuotes: [
      { citationId: 'C1', quote: 'We plan to run calibration.' },
      { citationId: 'C2', quote: 'Calibration is complete.' },
    ],
    value: {
      kind: 'commitment',
      stateKey: 'calibration',
      text: 'Calibration was reported complete.',
      status: 'completion_claimed',
      owner: null,
      deadline: null,
      completionCriteria: null,
    },
    rationale: 'Reported progress.',
    uncertainty: ['Verification is absent.'],
    missingInformation: ['Unknown owner and deadline.'],
  });
  return { scope, proposal };
}
test('changed proposals require exact supporting quotations from both selected meetings', () => {
  const { scope, proposal } = fixture();
  expect(() => validateProposal(proposal, scope)).not.toThrow();
  for (const invalid of [
    { ...proposal, earlierCitations: [] },
    { ...proposal, laterCitations: ['C1'] },
    { ...proposal, laterCitations: ['C99'] },
    {
      ...proposal,
      evidenceQuotes: [{ citationId: 'C1', quote: 'Invented source words.' }],
    },
  ])
    expect(() => validateProposal(invalid, scope)).toThrow();
});
test('new decisions can leave earlier statement unknown, and reported completion cannot be verified by the model', () => {
  const { scope, proposal } = fixture();
  expect(() =>
    validateProposal(
      { ...proposal, earlier: null, earlierCitations: [] },
      scope,
    ),
  ).not.toThrow();
  expect(() =>
    validateProposal(
      {
        ...proposal,
        value: { ...proposal.value, status: 'completion_verified' },
      },
      scope,
    ),
  ).toThrow('Meeting reports');
  expect(() =>
    validateProposal(
      { ...proposal, value: { ...proposal.value, kind: 'decision' } },
      scope,
    ),
  ).toThrow('Decisions');
});
test('comparison identity and frozen baseline target must agree', () => {
  const { scope, proposal } = fixture();
  expect(() =>
    validateProposal({ ...proposal, targetItemId: crypto.randomUUID() }, scope),
  ).toThrow('frozen');
  expect(() =>
    comparisonInput.parse({
      projectId: scope.projectId,
      earlierRevisionId: scope.earlier.revisionId,
      laterRevisionId: scope.later.revisionId,
      idempotencyKey: 'scope',
      arbitraryScope: true,
    }),
  ).toThrow();
});
test('approved original citations narrow to exact quoted offsets and pinned memory URLs', () => {
  const { scope, proposal } = fixture(),
    citations = proposalEvidence(proposal, scope, ['C1', 'C2']);
  expect(citations[0].quote).toBe('We plan to run calibration.');
  expect(citations[0].first).toBe(33);
  expect(citations[0].last! - citations[0].first!).toBe(
    citations[0].quote!.length,
  );
  expect(citations[0].url).toContain('knownVersion=2');
});
test('completion verification rejects missing action, criteria, supporting evidence and incompatible statuses', () => {
  const { scope, proposal } = fixture(),
    value = {
      ...proposal.value,
      status: 'completion_verified' as const,
      completionCriteria: 'All calibration cases pass.',
    };
  expect(() => validateApproval(value, true, scope.evidence)).not.toThrow();
  expect(() => validateApproval(value, false, scope.evidence)).toThrow();
  expect(() =>
    validateApproval(
      { ...value, completionCriteria: null },
      true,
      scope.evidence,
    ),
  ).toThrow();
  expect(() => validateApproval(value, true, [])).toThrow();
  expect(() =>
    validateApproval({ ...proposal.value }, true, scope.evidence),
  ).toThrow();
});
