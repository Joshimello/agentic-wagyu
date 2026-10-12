<script lang="ts">
  let { data } = $props();
</script>

<a href={`/changes/${data.job.id}`}>Open comparison</a>
<h1>Review event {data.event.reviewVersion}</h1>
<p class="muted">
  {data.event.reviewer} - {new Date(data.event.createdAt).toLocaleString()} - {data
    .event.input.action}
</p>
<section class="card">
  <h2>Original model proposal</h2>
  <p>{data.proposal.proposal.value.text}</p>
  <h2>Reviewer reason</h2>
  <p>{data.event.input.reason}</p>
</section>
{#if data.approved}<section class="card">
    <h2>Approved values</h2>
    <p>{data.approved.value.text}</p>
    <p>
      Status: {data.approved.value.status?.replaceAll('_', ' ') ?? 'Decision'}
    </p>
    <p>
      Owner: {data.approved.value.owner ?? 'Unknown'} - Deadline: {data.approved
        .value.deadline ?? 'Unknown'}
    </p>
    <p>
      Completion criteria: {data.approved.value.completionCriteria ?? 'Unknown'}
    </p>
    <p>
      Reviewer-added fields: {data.approved.reviewerAdded.join(', ') || 'None'}
    </p>
    {#each data.approved.evidence as c}<blockquote>
        <a href={c.url}>{c.filename}</a>
        <p>{c.quote}</p>
      </blockquote>{/each}
  </section>
  <section class="card">
    <h2>Approved history through this event</h2>
    {#each data.history as v}<p>
        <a href={`/changes/reviews/${v.eventId}`}>Review {v.reviewVersion}</a> - {v
          .value.text} - {v.value.status?.replaceAll('_', ' ') ?? 'Decision'}
      </p>{/each}
  </section>{:else}<p>
    Rejected proposal. No approved state was published.
  </p>{/if}

<style>
  h1 {
    margin: 20px 0;
    font-size: 27px;
  }
  h2 {
    font-size: 18px;
    margin: 16px 0;
  }
  p {
    margin: 12px 0;
    white-space: pre-wrap;
  }
  .card {
    margin: 20px 0;
  }
  blockquote {
    margin: 12px 0;
    padding: 12px;
    border-left: 3px solid var(--border);
  }
</style>
