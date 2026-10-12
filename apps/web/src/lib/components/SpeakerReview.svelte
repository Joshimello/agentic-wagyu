<script lang="ts">
  import type { Stage } from '../server/contracts';
  import { isUsableCandidateName } from '../speaker-names';
  import {
    speakerGroups,
    nameSpeakerTurns,
    speakerConfirmationMatches,
    type TranscriptText,
    type TranscriptDraft,
    type SpeakerReviewDraft,
    type SpeakerGroup,
  } from '../transcript-speakers';
  import Disclosure from './Disclosure.svelte';
  import Icon from './Icon.svelte';

  let {
    stage,
    texts,
    drafts = $bindable(),
    reviews = $bindable(),
    disabled = false,
    onshow,
    onplay,
  }: {
    stage: Stage;
    texts: TranscriptText[];
    drafts: TranscriptDraft[];
    reviews: SpeakerReviewDraft[];
    disabled?: boolean;
    onshow: (id: string) => void;
    onplay: (text: TranscriptText) => void;
  } = $props();
  let groups = $derived(speakerGroups(texts));
  let names = $state<Record<string, string>>({});
  let notice = $state('');
  let draftById = $derived(
    new Map(drafts.map((draft) => [draft.primitiveId, draft])),
  );

  function suggestions(group: SpeakerGroup) {
    const ids = new Set(group.turns.map((p) => p.id));
    return (stage.speakerSuggestions ?? []).filter(
      (s) =>
        s.speaker === group.originalSpeaker &&
        isUsableCandidateName(s.candidateName) &&
        (s.voiceTranscriptIds ?? s.transcriptIds).some((id) => ids.has(id)),
    );
  }
  function decision(
    suggestion: NonNullable<Stage['speakerSuggestions']>[number],
  ) {
    const status =
      reviews.find((r) => r.suggestionId === suggestion.id)?.decision ??
      suggestion.review;
    if (
      status === 'confirmed' &&
      !speakerConfirmationMatches(suggestion, texts, draftById)
    )
      return undefined;
    return status;
  }
  function review(suggestionId: string, value: SpeakerReviewDraft['decision']) {
    reviews = [
      ...reviews.filter((r) => r.suggestionId !== suggestionId),
      { suggestionId, decision: value },
    ];
    notice = 'Name review added to your draft. Save corrections to keep it.';
  }
  function apply(group: SpeakerGroup, name: string) {
    drafts = nameSpeakerTurns(drafts, group, name);
    names[group.key] = name.trim();
    const ids = new Set(suggestions(group).map((s) => s.id));
    reviews = reviews.filter(
      (r) => !ids.has(r.suggestionId) || r.decision !== 'confirmed',
    );
    notice = `${group.turns.length} ${group.turns.length === 1 ? 'entry' : 'entries'} updated in your draft. Save corrections to keep the name.`;
  }
  function currentNames(group: SpeakerGroup) {
    return [
      ...new Set(
        group.turns.map((p) => draftById.get(p.id)?.speaker ?? p.speaker ?? ''),
      ),
    ];
  }
  function groupLabel(group: SpeakerGroup) {
    const label =
      group.originalSpeaker ??
      `Unlabeled entry ${texts.indexOf(group.turns[0]) + 1}`;
    return groups.some(
      (other) =>
        other.originalSpeaker === group.originalSpeaker &&
        other.key !== group.key,
    )
      ? `${label} / ${group.speaker ?? 'Unnamed'}`
      : label;
  }
</script>

<section class="speaker-review" aria-label="Speaker names">
  <Disclosure
    title={`Speaker names (${groups.length})`}
    icon="users"
    open={true}
  >
    <p class="speaker-help">
      Apply a name to every entry with this voice label, including entries
      beyond the visible page. Labels in different recording sections stay
      separate. Correct a mixed-up voice on its individual entry.
    </p>
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#each groups as group (group.key)}
      {@const label = groupLabel(group)}
      {@const pendingNames = currentNames(group)}
      <article class="speaker-group" aria-label={`Speaker ${label}`}>
        <div class="speaker-heading">
          <strong>{label}</strong>
          <span class="muted"
            >{group.turns.length}
            {group.turns.length === 1 ? 'entry' : 'entries'}</span
          >
          {#if pendingNames.length > 1}<span class="badge"
              >Individual corrections</span
            >{/if}
        </div>
        <div class="name-controls">
          <label>
            Speaker name
            <input
              aria-label={`Name for ${label}`}
              value={names[group.key] ?? group.speaker ?? ''}
              oninput={(event) =>
                (names[group.key] = event.currentTarget.value)}
              placeholder="Name or speaker label"
              maxlength="100"
              {disabled}
            />
          </label>
          <button
            class="secondary small"
            {disabled}
            onclick={() =>
              apply(group, names[group.key] ?? group.speaker ?? '')}
            aria-label={`Apply name to ${label}`}
          >
            <Icon name="edit" size={14} />Apply to {group.turns.length}
            {group.turns.length === 1 ? 'entry' : 'entries'}
          </button>
          {#if group.originalSpeaker}<button
              class="secondary small"
              {disabled}
              onclick={() => apply(group, group.originalSpeaker!)}
              aria-label={`Restore label for ${label}`}>Restore label</button
            >{/if}
        </div>
        <div class="voice-evidence">
          <p>{group.turns[0].text}</p>
          <div class="actions">
            {#if group.turns[0].locator.kind === 'media'}<button
                class="secondary small"
                {disabled}
                onclick={() => onplay(group.turns[0])}
                aria-label={`Listen to ${label}`}
                ><Icon name="play" size={14} />Listen</button
              >{/if}
            <button
              class="secondary small"
              {disabled}
              onclick={() => onshow(group.turns[0].id)}
              aria-label={`Find entry for ${label}`}>Find in transcript</button
            >
          </div>
        </div>
        {#each suggestions(group) as suggestion (suggestion.id)}
          {@const status = decision(suggestion)}
          <div class="name-suggestion">
            <span>Suggested: <strong>{suggestion.candidateName}</strong></span>
            <span class="badge"
              >{status ??
                `${suggestion.confidence} confidence (unverified)`}</span
            >
            <p>{suggestion.reason}</p>
            <div class="actions">
              {#each suggestion.transcriptIds as ref, evidenceIndex}<button
                  class="secondary small"
                  {disabled}
                  onclick={() => onshow(ref)}
                  aria-label={`Name evidence ${evidenceIndex + 1} for ${suggestion.candidateName}`}
                  >Name evidence {evidenceIndex + 1}</button
                >{/each}
              <button
                class="secondary small"
                disabled={disabled || status === 'confirmed'}
                onclick={() => {
                  apply(group, suggestion.candidateName);
                  review(suggestion.id, 'confirmed');
                }}
                aria-label={`Confirm ${suggestion.candidateName} for ${label}`}
                >Confirm name</button
              >
              <button
                class="secondary small"
                disabled={disabled || status === 'rejected'}
                onclick={() => {
                  if (status === 'confirmed')
                    apply(group, group.originalSpeaker ?? '');
                  review(suggestion.id, 'rejected');
                }}
                aria-label={`Reject ${suggestion.candidateName} for ${label}`}
                >Reject suggestion</button
              >
            </div>
          </div>
        {/each}
      </article>
    {/each}
  </Disclosure>
</section>

<style>
  .speaker-review {
    margin-bottom: 1.5rem;
  }
  .speaker-help,
  .notice {
    font-size: 0.8rem;
    line-height: 1.6;
  }
  .speaker-help {
    color: var(--muted);
    margin: 0 0 1rem;
  }
  .speaker-group {
    padding: 1rem 0;
    border-top: 1px solid var(--border);
  }
  .speaker-heading,
  .name-controls {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
  .speaker-heading {
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .name-controls {
    align-items: flex-end;
    margin: 0.7rem 0;
  }
  .name-controls label {
    flex: 1;
    min-width: 12rem;
    font-size: 0.75rem;
  }
  .name-controls input {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
  }
  .voice-evidence p {
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.6;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .actions {
    flex-wrap: wrap;
  }
  .name-suggestion {
    margin-top: 0.8rem;
    padding: 0.8rem;
    background: var(--canvas);
    border-radius: 6px;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .name-suggestion .badge {
    margin-left: 0.4rem;
  }
  .name-suggestion p {
    margin: 0.5rem 0;
    line-height: 1.6;
  }
  @media (max-width: 700px) {
    .name-controls label {
      flex-basis: 100%;
      min-width: 0;
    }
  }
</style>
