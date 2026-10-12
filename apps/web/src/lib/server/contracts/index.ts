import { z } from 'zod';

export const id = z.string().uuid();
const ms = z.number().int().nonnegative();
export const locator = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('media'),
      timeline: z.literal('container'),
      startMs: ms,
      endMs: ms,
    })
    .strict(),
  z
    .object({ kind: z.literal('page'), page: z.number().int().positive() })
    .strict(),
  z
    .object({ kind: z.literal('slide'), slide: z.number().int().positive() })
    .strict(),
  z.object({ kind: z.literal('text'), start: ms, end: ms }).strict(),
  z
    .object({
      kind: z.literal('image'),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict(),
]);
export const metadata = z
  .object({
    uploader: z.string().min(1),
    uploadedAt: z.string().datetime(),
    sourceTime: z.string().datetime().nullable(),
    label: z.string(),
    sourceTimeOrigin: z.enum(['user', 'file', 'unknown']),
    groupId: id.optional(),
    groupHint: z.string().max(500).optional(),
  })
  .strict();
export const bounds = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    canvasWidth: z.number().positive(),
    canvasHeight: z.number().positive(),
    units: z.enum(['points', 'emu', 'pixels']),
    origin: z.literal('top_left'),
  })
  .strict();
export const textPrimitive = z
  .object({
    id,
    kind: z.literal('text'),
    role: z.enum(['asr', 'native', 'ocr', 'notes']),
    text: z.string(),
    speaker: z.string().nullable(),
    originalSpeaker: z.string().nullable().optional(),
    locator,
    bounds: bounds.nullable().optional(),
  })
  .strict();
export const imagePrimitive = z
  .object({
    id,
    kind: z.literal('image'),
    role: z.enum([
      'frame',
      'slide',
      'page',
      'original',
      'figure',
      'embedded_frame',
    ]),
    assetId: id,
    requestedMs: ms.nullable(),
    actualMs: ms.nullable(),
    locator,
  })
  .strict();
export const primitive = z.discriminatedUnion('kind', [
  textPrimitive,
  imagePrimitive,
]);
export const annotation = z
  .object({
    id,
    text: z.string().min(1),
    transcriptIds: z.array(id),
    frameIds: z.array(id).min(1),
    origin: z.literal('model'),
    model: z.string(),
    promptVersion: z.string(),
    questionId: id.optional(),
  })
  .strict();
export const speakerSuggestion = z
  .object({
    id,
    speaker: z.string().min(1),
    candidateName: z.string().min(1).max(100),
    confidence: z.enum(['low', 'medium', 'high']),
    basis: z.enum([
      'self_introduction',
      'speaker_indicator',
      'handoff',
      'contextual_guess',
    ]),
    reason: z.string().min(1),
    transcriptIds: z.array(id).min(1),
    voiceTranscriptIds: z.array(id).min(1).optional(),
    frameIds: z.array(id),
    model: z.string(),
    promptVersion: z.string(),
    review: z.enum(['confirmed', 'rejected']).optional(),
    identityQuote: z.string().min(1).max(500).optional(),
    activeSpeakerIndicator: z.boolean().optional(),
  })
  .strict();
const contextQuestion = z
  .object({
    id,
    question: z.string().min(1),
    purpose: z.enum(['visual_context', 'speaker_identity']),
    transcriptIds: z.array(id).min(1),
    status: z.enum(['answered', 'unresolved']),
    explanation: z.string(),
    searches: z.array(
      z
        .object({
          reason: z.string().min(1),
          timesMs: z.array(ms),
          frameIds: z.array(id),
        })
        .strict(),
    ),
  })
  .strict();
export const stageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    uploadId: id,
    rawAssetId: id,
    parentRevisionId: id.nullable(),
    createdAt: z.string().datetime(),
    metadata,
    primitives: z.array(primitive),
    annotations: z.array(annotation),
    document: z
      .object({
        format: z.enum(['pdf', 'pptx', 'image']),
        units: z
          .array(
            z
              .object({
                number: z.number().int().positive(),
                hidden: z.boolean(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
                textIds: z.array(id),
                renderId: id,
                complete: z.boolean(),
                warnings: z.array(z.string()),
                mediaIds: z.array(id).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(400),
        transform: z
          .object({
            exifOrientation: z.number().int().min(1).max(8),
            sourceWidth: z.number().int().positive(),
            sourceHeight: z.number().int().positive(),
            displayWidth: z.number().int().positive(),
            displayHeight: z.number().int().positive(),
          })
          .strict()
          .nullable(),
        tools: z.record(z.string(), z.string()),
        elapsedMs: ms,
        cached: z.boolean(),
        media: z
          .array(
            z
              .object({
                id,
                kind: z.enum(['image', 'video']),
                assetId: id,
                sourcePart: z.string().regex(/^ppt\/media\/[^/]+$/),
                unitNumbers: z.array(z.number().int().positive()),
                previewSourceUnit: z.number().int().positive().nullable(),
                previewOrigin: z.enum([
                  'decoded_image',
                  'video_frames',
                  'slide_crop',
                  'unavailable',
                ]),
                previewIds: z.array(id),
                durationMs: ms.nullable(),
                warnings: z.array(z.string()),
              })
              .strict(),
          )
          .optional(),
        review: z
          .object({
            model: z.string(),
            promptVersion: z.string(),
            createdAt: z.string().datetime(),
            unitLabels: z.array(
              z
                .object({
                  unitNumber: z.number().int().positive(),
                  label: z.string().min(1).max(160),
                  description: z.string().min(1).max(1000),
                  evidenceIds: z.array(id).min(1),
                })
                .strict(),
            ),
            mediaLabels: z.array(
              z
                .object({
                  mediaId: id,
                  label: z.string().min(1).max(160),
                  description: z.string().min(1).max(1000),
                  evidenceIds: z.array(id).min(1),
                })
                .strict(),
            ),
            skippedMedia: z
              .array(
                z
                  .object({
                    mediaId: id,
                    reason: z.enum([
                      'logo',
                      'classification_stamp',
                      'decoration',
                    ]),
                    evidenceIds: z.array(id).min(1),
                  })
                  .strict(),
              )
              .optional(),
            summary: z
              .object({
                text: z.string().min(1).max(8000),
                evidenceIds: z.array(id).min(1),
              })
              .strict()
              .nullable(),
            unitsRead: z.array(z.number().int().positive()),
            mediaRead: z.array(id),
            complete: z.boolean(),
            warnings: z.array(z.string()),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    speakerSuggestions: z.array(speakerSuggestion).optional(),
    speakerIdentity: z
      .object({
        model: z.string(),
        promptVersion: z.string(),
        voices: z.array(
          z
            .object({
              key: z.string(),
              speaker: z.string(),
              status: z.enum(['suggested', 'unresolved', 'deferred', 'failed']),
              reason: z.string(),
              transcriptIds: z.array(id),
              searches: z
                .array(
                  z
                    .object({
                      timesMs: z.array(ms).max(4),
                      frameIds: z.array(id).max(4),
                      reason: z.string(),
                    })
                    .strict(),
                )
                .max(2),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    context: z
      .object({
        model: z.string(),
        promptVersion: z.string(),
        readSegments: ms,
        totalSegments: ms,
        questions: z.array(contextQuestion),
      })
      .strict()
      .optional(),
    coverage: z
      .object({
        complete: z.boolean(),
        durationMs: ms.nullable(),
        warnings: z.array(z.string()),
      })
      .strict(),
    provenance: z
      .object({
        adapter: z.string(),
        model: z.string().nullable(),
        modelRevision: z.string().nullable(),
        promptVersion: z.string().nullable(),
        textNormalization: z
          .object({
            engine: z.literal('opencc-js'),
            version: z.string().min(1),
            conversion: z.literal('s2t'),
          })
          .strict()
          .optional(),
        transcription: z
          .object({
            runId: id,
            windowMs: ms,
            scope: z.enum(['recording', 'window']),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
export type Stage = z.infer<typeof stageSchema>;
export type Primitive = z.infer<typeof primitive>;

/** Validate foreign references and timeline semantics after structural parsing. */
export function validateStage(value: unknown): Stage {
  const stage = stageSchema.parse(value);
  const byId = new Map(stage.primitives.map((p) => [p.id, p]));
  if (byId.size !== stage.primitives.length)
    throw new Error('Duplicate primitive ID');
  const duration = stage.coverage.durationMs;
  for (const p of stage.primitives) {
    if (
      p.kind === 'text' &&
      p.originalSpeaker !== undefined &&
      p.role !== 'asr'
    )
      throw new Error(
        'Original speaker labels belong to spoken transcript turns',
      );
    if ('startMs' in p.locator) {
      if (
        p.locator.endMs < p.locator.startMs ||
        duration === null ||
        p.locator.endMs > duration
      )
        throw new Error('Invalid media interval');
    }
    if ('start' in p.locator && p.locator.end < p.locator.start)
      throw new Error('Invalid character interval');
    if (p.kind === 'image' && p.role === 'frame') {
      if (
        p.actualMs === null ||
        p.requestedMs === null ||
        duration === null ||
        p.actualMs >= duration ||
        p.requestedMs >= duration
      )
        throw new Error('Invalid frame timestamp');
      if (
        p.locator.kind !== 'media' ||
        p.locator.startMs !== p.actualMs ||
        p.locator.endMs !== p.actualMs
      )
        throw new Error('Frame locator must record actual container timestamp');
    }
  }
  if (
    new Set(stage.annotations.map((a) => a.id)).size !==
    stage.annotations.length
  )
    throw new Error('Duplicate annotation ID');
  for (const a of stage.annotations) {
    if (
      a.frameIds.some((ref) => byId.get(ref)?.kind !== 'image') ||
      a.transcriptIds.some((ref) => byId.get(ref)?.kind !== 'text')
    )
      throw new Error('Annotation references missing or wrong primitive');
    if (
      a.questionId &&
      !stage.context?.questions.some((q) => q.id === a.questionId)
    )
      throw new Error('Annotation refers to an unknown context question');
  }
  const speakers = new Set(
    stage.primitives.flatMap((p) =>
      p.kind === 'text'
        ? [
            p.originalSpeaker !== undefined ? p.originalSpeaker : p.speaker,
          ].filter((speaker): speaker is string => speaker !== null)
        : [],
    ),
  );
  for (const voice of stage.speakerIdentity?.voices ?? []) {
    if (
      !speakers.has(voice.speaker) ||
      voice.transcriptIds.some((ref) => byId.get(ref)?.kind !== 'text') ||
      voice.searches.some(
        (s) =>
          s.timesMs.some((t) => duration === null || t >= duration) ||
          s.frameIds.some((ref) => byId.get(ref)?.kind !== 'image'),
      )
    )
      throw new Error(
        'Speaker identity audit references unavailable speech or frames',
      );
  }
  for (const suggestion of stage.speakerSuggestions ?? []) {
    const voiceIds = suggestion.voiceTranscriptIds ?? suggestion.transcriptIds;
    if (
      !speakers.has(suggestion.speaker) ||
      suggestion.transcriptIds.some((ref) => byId.get(ref)?.kind !== 'text') ||
      suggestion.frameIds.some((ref) => byId.get(ref)?.kind !== 'image') ||
      !voiceIds.some((ref) => {
        const p = byId.get(ref);
        return (
          p?.kind === 'text' &&
          (p.originalSpeaker !== undefined ? p.originalSpeaker : p.speaker) ===
            suggestion.speaker
        );
      })
    )
      throw new Error(
        'Speaker suggestion lacks evidence for its anonymous speaker',
      );
    if (
      suggestion.voiceTranscriptIds &&
      (new Set(voiceIds).size !== voiceIds.length ||
        voiceIds.some((ref) => {
          const p = byId.get(ref);
          return (
            !suggestion.transcriptIds.includes(ref) ||
            p?.kind !== 'text' ||
            (p.originalSpeaker !== undefined
              ? p.originalSpeaker
              : p.speaker) !== suggestion.speaker
          );
        }))
    )
      throw new Error('Speaker voice evidence must belong to its cited voice');
    if (
      suggestion.review === 'confirmed' &&
      voiceIds.some((ref) => {
        const p = byId.get(ref);
        return (
          p?.kind === 'text' &&
          (p.originalSpeaker !== undefined ? p.originalSpeaker : p.speaker) ===
            suggestion.speaker &&
          p.speaker !== suggestion.candidateName
        );
      })
    )
      throw new Error(
        'Confirmed speaker name differs from the reviewed transcript',
      );
  }
  if (
    new Set((stage.speakerSuggestions ?? []).map((s) => s.id)).size !==
    (stage.speakerSuggestions ?? []).length
  )
    throw new Error('Duplicate speaker suggestion ID');
  if (stage.context) {
    const count = stage.primitives.filter((p) => p.kind === 'text').length;
    if (
      stage.context.totalSegments !== count ||
      stage.context.readSegments > count
    )
      throw new Error('Invalid transcript reading coverage');
    if (
      new Set(stage.context.questions.map((q) => q.id)).size !==
      stage.context.questions.length
    )
      throw new Error('Duplicate context question ID');
    for (const q of stage.context.questions)
      if (
        q.transcriptIds.some((ref) => byId.get(ref)?.kind !== 'text') ||
        q.searches.some(
          (s) =>
            s.frameIds.some((ref) => byId.get(ref)?.kind !== 'image') ||
            s.timesMs.some((t) => duration === null || t >= duration),
        )
      )
        throw new Error(
          'Context search evidence is missing or outside the recording',
        );
  }
  if (!stage.coverage.complete && stage.coverage.warnings.length === 0)
    throw new Error('Incomplete coverage must be explained');
  if (stage.document) {
    const used = new Set<string>();
    const format = stage.document.format;
    for (const [index, unit] of stage.document.units.entries()) {
      if (unit.number !== index + 1)
        throw new Error(
          'Document units must retain contiguous source numbering',
        );
      const render = byId.get(unit.renderId);
      const matches = (p: Primitive) =>
        format === 'pdf'
          ? p.locator.kind === 'page' && p.locator.page === unit.number
          : format === 'pptx'
            ? p.locator.kind === 'slide' && p.locator.slide === unit.number
            : p.locator.kind === 'image' &&
              p.locator.width === unit.width &&
              p.locator.height === unit.height;
      if (
        !render ||
        render.kind !== 'image' ||
        render.role !==
          (format === 'pdf'
            ? 'page'
            : format === 'pptx'
              ? 'slide'
              : 'original') ||
        !matches(render)
      )
        throw new Error('Document unit must reference its own source render');
      for (const ref of [unit.renderId, ...unit.textIds]) {
        const p = byId.get(ref);
        if (
          !p ||
          used.has(ref) ||
          !matches(p) ||
          (ref !== unit.renderId &&
            (p.kind !== 'text' || p.role === 'asr' || p.speaker !== null))
        )
          throw new Error(
            'Invalid document source mapping or speech attribution',
          );
        used.add(ref);
      }
      if (!unit.complete && !unit.warnings.length)
        throw new Error('Incomplete document unit must be explained');
    }
    const media = stage.document.media ?? [];
    const byMedia = new Map(media.map((m) => [m.id, m]));
    if (byMedia.size !== media.length)
      throw new Error('Duplicate document media ID');
    for (const item of media) {
      if (
        format !== 'pptx' ||
        new Set(item.unitNumbers).size !== item.unitNumbers.length ||
        item.unitNumbers.some(
          (n) => !stage.document!.units.some((u) => u.number === n),
        ) ||
        (item.previewSourceUnit !== null &&
          !item.unitNumbers.includes(item.previewSourceUnit))
      )
        throw new Error('Invalid embedded media source lineage');
      if (new Set(item.previewIds).size !== item.previewIds.length)
        throw new Error('Duplicate media preview');
      for (const ref of item.previewIds) {
        const p = byId.get(ref);
        if (
          !p ||
          p.kind !== 'image' ||
          used.has(ref) ||
          p.role !== (item.kind === 'video' ? 'embedded_frame' : 'figure') ||
          (item.previewSourceUnit !== null
            ? p.locator.kind !== 'slide' ||
              p.locator.slide !== item.previewSourceUnit
            : p.locator.kind !== 'image')
        )
          throw new Error('Invalid embedded media preview');
        if (
          item.kind === 'video' &&
          (item.durationMs === null ||
            p.actualMs === null ||
            p.requestedMs === null ||
            p.actualMs >= item.durationMs ||
            p.requestedMs >= item.durationMs)
        )
          throw new Error('Embedded frame escapes its clip timeline');
        used.add(ref);
      }
    }
    for (const unit of stage.document.units) {
      const expected = media
        .filter((m) => m.unitNumbers.includes(unit.number))
        .map((m) => m.id);
      if (
        new Set(unit.mediaIds ?? []).size !== (unit.mediaIds ?? []).length ||
        expected.length !== (unit.mediaIds ?? []).length ||
        (unit.mediaIds ?? []).some((ref) => !expected.includes(ref))
      )
        throw new Error('Slide media links do not match source occurrences');
    }
    const review = stage.document.review;
    if (review) {
      const units = stage.document.units;
      const checkEvidence = (refs: string[]) =>
        refs.every((ref) => byId.has(ref));
      if (
        new Set(review.unitsRead).size !== review.unitsRead.length ||
        review.unitsRead.some((n) => !units.some((u) => u.number === n)) ||
        new Set(review.mediaRead).size !== review.mediaRead.length ||
        review.mediaRead.some((ref) => !byMedia.has(ref))
      )
        throw new Error('Invalid document review coverage');
      if (
        new Set(review.unitLabels.map((l) => l.unitNumber)).size !==
          review.unitLabels.length ||
        review.unitLabels.length !== review.unitsRead.length
      )
        throw new Error('Document labels do not match reading coverage');
      for (const label of review.unitLabels) {
        const unit = units.find((u) => u.number === label.unitNumber);
        if (
          !unit ||
          !review.unitsRead.includes(unit.number) ||
          !checkEvidence(label.evidenceIds) ||
          !label.evidenceIds.includes(unit.renderId) ||
          label.evidenceIds.some(
            (ref) => ![unit.renderId, ...unit.textIds].includes(ref),
          )
        )
          throw new Error('Slide label lacks its source evidence');
      }
      const mediaDecisions = [
        ...review.mediaLabels,
        ...(review.skippedMedia ?? []),
      ];
      if (
        new Set(mediaDecisions.map((l) => l.mediaId)).size !==
          mediaDecisions.length ||
        mediaDecisions.length !== review.mediaRead.length
      )
        throw new Error('Media labels do not match reading coverage');
      for (const label of mediaDecisions) {
        const item = byMedia.get(label.mediaId);
        if (
          !item ||
          ('reason' in label && item.kind !== 'image') ||
          !review.mediaRead.includes(item.id) ||
          !checkEvidence(label.evidenceIds) ||
          label.evidenceIds.some((ref) => !item.previewIds.includes(ref))
        )
          throw new Error('Media label cites another artifact');
      }
      if (
        review.summary &&
        (!checkEvidence(review.summary.evidenceIds) ||
          review.summary.evidenceIds.some(
            (ref) =>
              !review.unitLabels.some((l) => l.evidenceIds.includes(ref)),
          ))
      )
        throw new Error('Document summary cites unread evidence');
      if (
        review.complete !==
        (review.unitsRead.length === units.length &&
          review.mediaRead.length === media.length &&
          review.summary !== null)
      )
        throw new Error('Document review completeness mismatch');
      if (!review.complete && !review.warnings.length)
        throw new Error('Incomplete document descriptions must be explained');
    }
    if (
      used.size !== stage.primitives.length ||
      stage.coverage.complete !== stage.document.units.every((u) => u.complete)
    )
      throw new Error('Document coverage does not match its mapped primitives');
  }
  return stage;
}

export const runStates = [
  'queued',
  'processing',
  'ready',
  'ready_with_warnings',
  'failed',
  'canceled',
] as const;
export type RunState = (typeof runStates)[number];
const transitions: Record<RunState, readonly RunState[]> = {
  queued: ['processing', 'canceled'],
  processing: ['ready', 'ready_with_warnings', 'failed', 'canceled'],
  ready: [],
  ready_with_warnings: [],
  failed: ['queued', 'canceled'],
  canceled: ['queued'],
};
export function transition(from: RunState, to: RunState) {
  if (!transitions[from].includes(to))
    throw new Error(`Invalid transition ${from} -> ${to}`);
  return to;
}
export const pushSchema = z
  .object({
    id,
    idempotencyKey: z.string().min(1),
    createdAt: z.string().datetime(),
    expectedMemoryVersion: ms,
    items: z
      .array(
        z
          .object({ uploadId: id, revisionId: id, acceptPartial: z.boolean() })
          .strict(),
      )
      .min(1),
  })
  .strict();
export function validatePush(value: unknown, revisions: Stage[]) {
  const push = pushSchema.parse(value);
  if (new Set(push.items.map((i) => i.uploadId)).size !== push.items.length)
    throw new Error('Duplicate upload selection');
  for (const item of push.items) {
    const rev = revisions.find(
      (r) => r.id === item.revisionId && r.uploadId === item.uploadId,
    );
    if (!rev || (!rev.coverage.complete && !item.acceptPartial))
      throw new Error('Push must pin an available accepted revision');
  }
  return push;
}
export const memorySchema = z
  .object({
    version: z.number().int().positive(),
    pushId: id,
    committedAt: z.string().datetime(),
    assertions: z.array(
      z
        .object({
          id,
          text: z.string().min(1),
          effectiveAt: z.string().datetime().nullable(),
          evidence: z
            .array(z.object({ revisionId: id, primitiveId: id }).strict())
            .min(1),
        })
        .strict(),
    ),
  })
  .strict();
export const querySchema = z
  .object({
    question: z.string().min(1),
    memoryVersion: ms,
    effectiveAt: z.string().datetime().nullable(),
    knownAt: z.string().datetime(),
  })
  .strict();
export function assertReadScope(
  snapshotVersion: number,
  commitVersion: number,
  revisionId: string,
  admittedRevisions: ReadonlySet<string>,
) {
  if (commitVersion > snapshotVersion || !admittedRevisions.has(revisionId))
    throw new Error('Evidence outside committed query snapshot');
}
