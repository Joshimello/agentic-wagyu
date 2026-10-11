<script lang="ts">
  let { data } = $props();
</script>

<h1>Operations</h1>
<p>
  Model requests for {data.usage.day} (UTC). Actual provider tokens are used when
  available. Unknown or interrupted requests keep their input estimate and output
  reservation.
</p>
<section class="card">
  <h2>Usage limits</h2>
  <p>
    Per operation: {data.usage.limits.calls || 'unlimited'} HTTP attempts · {data
      .usage.limits.input
      ? data.usage.limits.input.toLocaleString()
      : 'unlimited'}
    input tokens · {data.usage.limits.output
      ? data.usage.limits.output.toLocaleString()
      : 'unlimited'} output tokens.
  </p>
  <p>
    Daily token ceiling: {data.usage.limits.daily
      ? data.usage.limits.daily.toLocaleString()
      : 'disabled'}. Retries of the same operation share its budget.
  </p>
  <p>
    Preflight input allowance uses one token per serialized character plus 4,096
    per image. This is a conservative allowance, not an exact tokenizer. Dollar
    amounts require configured input and output prices.
  </p>
</section>
<section class="card">
  <h2>Today’s model usage</h2>
  {#if !data.usage.rows.length}<p>No recorded model requests today.</p>{/if}
  {#each data.usage.rows as row}<article>
      <h3>{row.kind}</h3>
      <p>
        {row.calls} attempts · {row.measured} with measured tokens · {row.input.toLocaleString()}
        input · {row.output.toLocaleString()} output · {row.costUsd === null
          ? 'Cost not configured or incomplete'
          : `$${row.costUsd}`}
      </p>
    </article>{/each}
</section>
