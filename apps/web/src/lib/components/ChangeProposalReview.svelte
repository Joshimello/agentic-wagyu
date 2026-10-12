<script lang="ts">
  import { untrack } from 'svelte';
  import type {
    ChangeProposal,
    ComparisonScope,
    ReviewedValue,
  } from '../server/contracts/changes';
  import type { changeReviewEvents } from '../server/db/schema';
  let {
    proposalId,
    proposal,
    scope,
    review,
    onreviewed,
  }: {
    proposalId: string;
    proposal: ChangeProposal;
    scope: ComparisonScope;
    review: typeof changeReviewEvents.$inferSelect | null;
    onreviewed: () => Promise<void>;
  } = $props();
  let editing = $state(false),
    busy = $state(false),
    error = $state(''),
    reason = $state(''),
    verify = $state(false);
  let value = $state<ReviewedValue>(
    untrack(() => structuredClone(proposal.value)),
  );
  let selected = $state(
    untrack(() => [
      ...new Set([...proposal.earlierCitations, ...proposal.laterCitations]),
    ]),
  );
  let key = '',
    payload = '';
  const quote = (ref: string) =>
    proposal.evidenceQuotes.find((q) => q.citationId === ref)?.quote ??
    scope.evidence.find((c) => c.id === ref)?.quote ??
    '';
  async function act(action: 'approve' | 'edit' | 'reject') {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const input = {
        action,
        reason,
        ...(action === 'edit'
          ? { value, evidenceIds: selected, verifyCompletion: verify }
          : {}),
      };
      if (payload !== JSON.stringify(input)) {
        payload = JSON.stringify(input);
        key = crypto.randomUUID();
      }
      const r = await fetch(`/api/change-proposals/${proposalId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey: key }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await onreviewed();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Review failed';
    } finally {
      busy = false;
    }
  }
</script>

<article class="card proposal">
  <div class="proposal-heading">
    <span class="badge">{proposal.value.kind}</span><span class="badge"
      >{review
        ? `${review.input.action === 'reject' ? 'Rejected' : 'Approved'} - review ${review.reviewVersion}`
        : 'Pending review'}</span
    >
  </div>
  <div class="comparison">
    <section>
      <h3>Earlier statement</h3>
      <p>
        {proposal.earlier ??
          'No earlier statement established by the selected evidence.'}
      </p>
      {#each proposal.earlierCitations as ref}{@const c = scope.evidence.find(
          (c) => c.id === ref,
        )}{#if c}<blockquote>
            <a href={c.url}>{c.filename}</a>
            <p>{quote(ref)}</p>
          </blockquote>{/if}{/each}
    </section>
    <section>
      <h3>Later statement</h3>
      <p>{proposal.value.text}</p>
      {#each proposal.laterCitations as ref}{@const c = scope.evidence.find(
          (c) => c.id === ref,
        )}{#if c}<blockquote>
            <a href={c.url}>{c.filename}</a>
            <p>{quote(ref)}</p>
          </blockquote>{/if}{/each}
    </section>
  </div>
  <p>{proposal.rationale}</p>
  <p class="muted">
    Status: {proposal.value.status?.replaceAll('_', ' ') ?? 'Decision'} - Owner: {proposal
      .value.owner ?? 'Unknown'} - Deadline: {proposal.value.deadline ??
      'Unknown'}
  </p>
  <p class="muted">
    Completion criteria: {proposal.value.completionCriteria ?? 'Unknown'}
  </p>
  {#if proposal.uncertainty.length || proposal.missingInformation.length}<ul>
      {#each [...proposal.uncertainty, ...proposal.missingInformation] as note}<li
        >
          {note}
        </li>{/each}
    </ul>{/if}
  {#if review}<p>Reviewer action: {review.input.reason}</p>
    <a href={`/changes/reviews/${review.id}`}>Open immutable review event</a>
  {:else}
    {#if editing}<div class="editor">
        <p>
          Edited fields are recorded as reviewer additions, separately from
          meeting reports.
        </p>
        <label
          >Approved statement<textarea bind:value={value.text} rows="3"
          ></textarea></label
        >
        {#if value.kind === 'commitment'}<label
            >Commitment status<select bind:value={value.status}
              >{#each ['planned', 'in_progress', 'completion_claimed', 'completion_verified', 'canceled'] as status}<option
                  value={status}>{status.replaceAll('_', ' ')}</option
                >{/each}</select
            ></label
          >{/if}
        <div class="fields">
          <label
            >Owner<input
              value={value.owner ?? ''}
              oninput={(e) =>
                (value.owner = e.currentTarget.value.trim() || null)}
              placeholder="Unknown"
            /></label
          ><label
            >Deadline<input
              type="date"
              value={value.deadline ?? ''}
              oninput={(e) => (value.deadline = e.currentTarget.value || null)}
            /></label
          >
        </div>
        <label
          >Completion criteria<textarea
            value={value.completionCriteria ?? ''}
            oninput={(e) =>
              (value.completionCriteria = e.currentTarget.value.trim() || null)}
            rows="2"
            placeholder="Unknown"></textarea></label
        >
        <fieldset>
          <legend>Supporting original evidence</legend
          >{#each [...new Set( [...proposal.earlierCitations, ...proposal.laterCitations] )] as ref}<label
              class="check"
              ><input
                type="checkbox"
                checked={selected.includes(ref)}
                onchange={(e) =>
                  (selected = e.currentTarget.checked
                    ? [...selected, ref]
                    : selected.filter((id) => id !== ref))}
              /><span>{quote(ref)}</span></label
            >{/each}
        </fieldset>
        {#if value.status === 'completion_verified'}<label class="check"
            ><input type="checkbox" bind:checked={verify} /><span
              >I explicitly verify completion against these criteria and
              supporting evidence.</span
            ></label
          >{/if}
      </div>{/if}
    <label
      >Review reason<textarea
        bind:value={reason}
        rows="2"
        placeholder="Why you approve, edit or reject this proposal"
      ></textarea></label
    >
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button
        disabled={busy || !reason.trim()}
        onclick={() => act(editing ? 'edit' : 'approve')}
        >{editing ? 'Edit and approve' : 'Approve'}</button
      ><button
        class="secondary"
        disabled={busy}
        onclick={() => (editing = !editing)}
        >{editing ? 'Close editor' : 'Edit proposal'}</button
      ><button
        class="secondary"
        disabled={busy || !reason.trim()}
        onclick={() => act('reject')}>Reject</button
      >
    </div>
  {/if}
</article>

<style>
  .proposal {
    margin: 22px 0;
  }
  .proposal-heading {
    display: flex;
    gap: 8px;
  }
  .comparison {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 22px 0;
  }
  h3 {
    font-size: 15px;
    margin-bottom: 10px;
  }
  p {
    margin: 12px 0;
    white-space: pre-wrap;
  }
  blockquote {
    margin: 16px 0;
    padding: 12px;
    border-left: 3px solid var(--border);
    background: var(--surface-soft, #f6f7f9);
    font-size: 13px;
  }
  label {
    display: grid;
    gap: 8px;
    margin: 16px 0;
  }
  input,
  textarea,
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface, #fff);
    color: inherit;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .check input {
    width: auto;
    margin-top: 4px;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .editor {
    padding: 16px;
    background: var(--surface-soft, #f7f8fa);
    border-radius: 10px;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
  }
  ul {
    padding-left: 20px;
  }
  @media (max-width: 650px) {
    .comparison,
    .fields {
      grid-template-columns: 1fr;
      gap: 10px;
    }
  }
</style>
