import {sqlClient} from '../../apps/web/src/lib/server/db/client';
import {meeting,admit} from '../../apps/web/tests/support/changes-fixtures';
import {createComparison,getComparison,reviewChange} from '../../apps/web/src/lib/server/services/changes';
import {compare} from '../../apps/web/src/lib/server/agents/changes';
import {createResearch,getResearch} from '../../apps/web/src/lib/server/services/research';
import {research} from '../../apps/web/src/lib/server/agents/researcher';
if(!new URL(process.env.DATABASE_URL!).pathname.startsWith('/chronicler_changes_live_'))throw new Error('Live checks require a dedicated disposable database');
try{
  const earlier=await meeting('We decided to run the camera calibration test. We plan to complete the calibration test before comparing camera poses. No owner or deadline was assigned.','earlier.mp4');
  const projectId=(await admit(earlier)).projectId;
  const later=await meeting('The camera calibration test is now complete. This is a reported completion; nobody has independently verified the acceptance criteria. We will keep the calibration decision. No owner or deadline has been assigned.','later.mp4');
  await admit(later,projectId);
  const job=await createComparison({projectId,earlierRevisionId:earlier.id,laterRevisionId:later.id,idempotencyKey:crypto.randomUUID()});
  await compare(job.id,0);
  const result=await getComparison(job.id);
  const proposed=result.proposals.find(p=>p.proposal.value.kind==='commitment'&&p.proposal.value.status==='completion_claimed');
  if(!proposed){console.error(JSON.stringify({state:result.job.state,error:result.job.error,warnings:result.job.warnings,proposals:result.proposals.map(p=>p.proposal)},null,2));throw new Error('Configured model did not establish the reported commitment change');}
  if(proposed.proposal.value.owner!==null||proposed.proposal.value.deadline!==null)throw new Error('Configured model invented missing ownership or deadline');
  const approved=await reviewChange(proposed.id,{idempotencyKey:crypto.randomUUID(),action:'edit',reason:'Synthetic workflow check only.',value:{...proposed.proposal.value,owner:'Reviewer supplied owner'}});
  const question=await createResearch({question:'What is the currently approved calibration commitment status, and who did the reviewer assign as its owner? Inspect approved state, distinguish claimed completion from verification, and identify reviewer-added information.',projectId,idempotencyKey:crypto.randomUUID()});
  await research(question.id);
  const answer=(await getResearch(question.id)).answer;
  if(!answer?.reviewReferences?.some(r=>r.eventId===approved.id&&r.reviewerAdded.includes('owner'))||!answer.claims.some(c=>c.basis==='reviewed'))throw new Error('Configured Ask model did not use the approved review event');
  console.log(JSON.stringify({model:result.job.model,memoryVersion:question.scope.version,reviewVersion:question.scope.reviewVersion,proposals:result.proposals.length,reviewedClaims:answer.claims.filter(c=>c.basis==='reviewed').length,reviewReferences:answer.reviewReferences.length,ownerProvenance:'reviewer supplied',completion:'claimed, not verified'}));
}finally{await sqlClient.end();}
