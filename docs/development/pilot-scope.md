# Frozen pilot scope

The maintained fixture specification is `evals/pilot.json`. It was committed before any model evaluation. Generated video, deck, audio, gold timing labels, and reports live under ignored `data/fixtures/`.

The first runtime supports English recordings of at most 300 seconds, one video per GPU worker. The short synthetic meeting has four turns from two distinct espeak voices and three visible slides. A repeated 300-second recording measures runtime and memory. This is an engineering pilot; synthetic speech is not representative of real meeting diarization or transcription quality. Longer recordings and real multilingual meetings require a separate evaluation before raising the limit.

Frozen gates: short-meeting normalized word error rate ≤25%; at least two anonymous speaker labels; ≥95% of labeled turn boundaries within two seconds; all references valid; visual annotations recover Friday, twelve customers, and green status; each inference ≤900 seconds and peak allocated GPU memory ≤80 GiB. Timing comparison aligns generated text to expected turns, rather than assuming the model segments speech at exactly the fixture's turn boundaries. Full speaker error rate needs human recordings with labeled speakers and is not claimed here.

Historical scenarios A/B/C in the fixture preserve event time separately from ingestion time: A records Friday, B later replaces it with Monday, and C disputes B. These are future memory regression inputs, not assertions that automatically enter memory during interpretation. Uploading the video or deck grants no memory read authority.

MOSS model weights and custom code are pinned at `704aa4a9c304e8520be88901e0d1960158ef5b15`; runtime source is pinned at `61bc29cd4120be7b5d3b761b64cd5dff57263642`. Only this trusted upstream custom code is loaded. One selected GPU receives CDI access. Dependency resolution lives in `services/media/uv.lock`.
