import { eq } from 'drizzle-orm';
import { db, sqlClient } from '../../src/lib/server/db/client';
import { researchRuns } from '../../src/lib/server/db/schema';
import {
  createResearch,
  loadResearchCorpus,
} from '../../src/lib/server/services/research';
import {
  reviewChange,
  getComparison,
} from '../../src/lib/server/services/changes';
import { meeting, admit, completedComparison } from './changes-fixtures';
if (
  !new URL(process.env.DATABASE_URL!).pathname.startsWith(
    '/chronicler_changes_browser_',
  )
)
  throw new Error('Browser fixtures require their isolated database');
const earlier = await meeting(
    'We plan to run the calibration test.',
    'earlier-unknown.mp4',
  ),
  projectId = (await admit(earlier)).projectId;
const later = await meeting(
  'The calibration test is complete.',
  'later-unknown.mp4',
);
await admit(later, projectId);
const saved = await completedComparison(
  projectId,
  earlier,
  later,
  'saved-reviewed-state',
);
const savedProposal = (await getComparison(saved.id)).proposals[0];
await reviewChange(savedProposal.id, {
  idempotencyKey: crypto.randomUUID(),
  action: 'edit',
  reason: 'Reviewed the original source reports.',
  value: { ...savedProposal.proposal.value, owner: 'Reviewer supplied owner' },
});
const question = await createResearch({
  question: 'What is the reviewed calibration status?',
  projectId,
  idempotencyKey: crypto.randomUUID(),
});
const corpus = await loadResearchCorpus(question.scope),
  state = corpus.approvedState().items[0];
const answer = corpus.validate({
  status: 'answered',
  claims: [
    {
      text: 'The calibration test is reported complete; the owner was supplied by the reviewer.',
      basis: 'reviewed',
      citations: [],
      reviewRefs: [state.reviewRef],
    },
  ],
  limitations: ['Completion has been claimed, not independently verified.'],
});
await db
  .update(researchRuns)
  .set({ state: 'completed', answer })
  .where(eq(researchRuns.id, question.id));
const modes = [];
for (const width of [1280, 390]) {
  const approve = await completedComparison(
    projectId,
    earlier,
    later,
    `approve-${width}`,
  );
  const edit = await completedComparison(
    projectId,
    earlier,
    later,
    `edit-${width}`,
  );
  const reject = await completedComparison(
    projectId,
    earlier,
    later,
    `reject-${width}`,
  );
  modes.push({ width, approve: approve.id, edit: edit.id, reject: reject.id });
}
await Bun.write(
  '/data/changes-browser.json',
  JSON.stringify({
    projectId,
    earlierRevisionId: earlier.id,
    laterRevisionId: later.id,
    uploadId: later.uploadId,
    questionId: question.id,
    modes,
  }),
);
await sqlClient.end();
