import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { uploads, revisions } from '../db/schema';
import { validateStage, id, type Stage } from '../contracts';
import { isUsableCandidateName } from '../../speaker-names';
import { cleanEnglishReview } from '../review-language';
import {
  normalizeTranscription,
  traditionalChinese,
} from '../text-normalization';
export const correctionSchema = z
  .object({
    baseRevisionId: id,
    label: z.string().max(500),
    sourceTime: z.string().datetime().nullable(),
    edits: z
      .array(
        z
          .object({
            primitiveId: id,
            text: z.string().max(1000000),
            speaker: z.string().max(100).nullable(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export async function correctStage(uploadId: string, value: unknown) {
  const correction = correctionSchema.parse(value);
  return db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .for('update');
    if (!upload || upload.currentRevisionId !== correction.baseRevisionId)
      throw new Error(
        'Staging changed. Reload the current revision before saving your correction.',
      );
    const [base] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, correction.baseRevisionId));
    const stage: Stage = structuredClone(base.manifest);
    normalizeTranscription(stage);
    cleanEnglishReview(stage);
    stage.id = crypto.randomUUID();
    stage.parentRevisionId = base.id;
    stage.createdAt = new Date().toISOString();
    if (
      new Set(correction.edits.map((e) => e.primitiveId)).size !==
      correction.edits.length
    )
      throw new Error('Duplicate correction');
    const changed = new Set<string>();
    for (const edit of correction.edits) {
      const p = stage.primitives.find((p) => p.id === edit.primitiveId);
      if (!p || p.kind !== 'text')
        throw new Error('Correction refers to missing text');
      const text =
        p.role === 'asr' && edit.text !== p.text
          ? traditionalChinese(edit.text)
          : edit.text;
      if (p.text !== text || p.speaker !== edit.speaker) changed.add(p.id);
      p.text = text;
      p.speaker = edit.speaker;
    }
    if (stage.speakerSuggestions) {
      const previous = stage.speakerSuggestions.length;
      stage.speakerSuggestions = stage.speakerSuggestions.filter(
        (s) =>
          isUsableCandidateName(s.candidateName) &&
          !s.transcriptIds.some((ref) => changed.has(ref)),
      );
      if (stage.speakerSuggestions.length < previous)
        stage.coverage.warnings.push(
          'Unsupported or outdated speaker name suggestions were removed; revisit visual context to review them.',
        );
    }
    if (stage.context && changed.size) {
      stage.context.readSegments = Math.max(
        0,
        stage.context.readSegments - changed.size,
      );
      for (const question of stage.context.questions)
        if (question.transcriptIds.some((ref) => changed.has(ref))) {
          question.status = 'unresolved';
          question.explanation =
            'Cited speech was corrected after this interpretation; revisit visual context to review the question again.';
        }
    }
    stage.metadata.label = correction.label;
    if (stage.document?.review && changed.size) {
      const previous = stage.document.review;
      stage.coverage.warnings = stage.coverage.warnings.filter(
        (w) => !previous.warnings.includes(w),
      );
      delete stage.document.review;
      stage.provenance.model = null;
      stage.provenance.promptVersion = null;
      stage.coverage.warnings.push(
        'Source text was corrected; revisit document descriptions to generate updated labels and summary.',
      );
    }
    stage.metadata.sourceTime = correction.sourceTime;
    stage.metadata.sourceTimeOrigin = correction.sourceTime
      ? 'user'
      : 'unknown';
    stage.provenance.adapter = 'user-correction-1';
    if (changed.size && stage.annotations.length)
      stage.coverage.warnings.push(
        'Visual annotations were retained from the previous revision; review them after text corrections.',
      );
    validateStage(stage);
    await tx.insert(revisions).values({
      id: stage.id,
      uploadId,
      parentRevisionId: base.id,
      manifest: stage,
    });
    await tx
      .update(uploads)
      .set({ currentRevisionId: stage.id })
      .where(eq(uploads.id, uploadId));
    return stage;
  });
}
export function exportMarkdown(stage: Stage, filename: string, origin: string) {
  const clean = (text: string) => text.replace(/[\r\n]/g, ' ');
  const lines = [
    `# ${clean(stage.metadata.label || filename)}`,
    '',
    `Source: ${clean(filename)}`,
    `Revision: ${stage.id}`,
    `Uploaded by: ${clean(stage.metadata.uploader)}`,
    `Uploaded at: ${stage.metadata.uploadedAt}`,
    `Source time: ${stage.metadata.sourceTime ?? 'Unknown'}`,
    `Raw file: ${origin}/api/assets/${stage.rawAssetId}`,
    '',
    'This is staging evidence. It has not been pushed to memory.',
    '',
  ];
  if (stage.coverage.warnings.length)
    lines.push(
      '## Coverage and warnings',
      '',
      ...stage.coverage.warnings.map((w) => `- ${clean(w)}`),
      '',
    );
  if (stage.document) {
    const review = stage.document.review;
    if (review?.summary)
      lines.push(
        '## Document summary',
        '',
        review.summary.text,
        '',
        `Model description: ${clean(review.model)} · ${clean(review.promptVersion)}`,
        '',
        `Reviewed ${review.unitsRead.length}/${stage.document.units.length} pages/slides and ${review.mediaRead.length}/${(stage.document.media ?? []).length} media${review.complete ? '' : ' (partial)'}.`,
        '',
        ...stage.document.units
          .filter((u) => review.summary!.evidenceIds.includes(u.renderId))
          .map((u) => `Summary source: [${u.number}](#unit-${u.number})`),
        '',
      );
    lines.push(
      '## Document extraction',
      '',
      `Format: ${stage.document.format}`,
      `Tools: ${JSON.stringify(stage.document.tools)}`,
      'Native text, speaker notes and OCR remain separate evidence roles.',
      '',
    );
    for (const unit of stage.document.units) {
      const label = review?.unitLabels.find(
        (l) => l.unitNumber === unit.number,
      );
      const name =
        stage.document.format === 'pptx'
          ? 'Slide'
          : stage.document.format === 'pdf'
            ? 'Page'
            : 'Image';
      lines.push(
        `<a id="unit-${unit.number}"></a>`,
        `## ${name} ${unit.number}${unit.hidden ? ' (hidden)' : ''}`,
        '',
        ...(label
          ? [`**${clean(label.label)}**`, '', label.description, '']
          : []),
        ...unit.warnings.map((w) => `- ${clean(w)}`),
      );
      const render = stage.primitives.find((p) => p.id === unit.renderId);
      if (render?.kind === 'image')
        lines.push(
          `<a id="frame-${render.id}"></a>`,
          `![${name} ${unit.number}](${origin}/api/assets/${render.assetId})`,
          '',
        );
      for (const ref of unit.textIds) {
        const text = stage.primitives.find((p) => p.id === ref);
        if (text?.kind === 'text')
          lines.push(
            `<a id="text-${ref}"></a>`,
            `### ${text.role === 'notes' ? 'Speaker notes (not spoken transcript)' : text.role === 'ocr' ? 'OCR (uncertain)' : 'Native text'}`,
            '',
            text.text,
            '',
            ...(text.bounds
              ? [`Source bounds: ${JSON.stringify(text.bounds)}`, '']
              : []),
          );
      }
    }
    if (stage.document.media?.length) lines.push('## Embedded media', '');
    for (const media of stage.document.media ?? []) {
      const label = review?.mediaLabels.find((l) => l.mediaId === media.id);
      lines.push(
        `### ${clean(label?.label ?? media.sourcePart)}`,
        '',
        label?.description ?? 'No generated description available.',
        '',
        `Original ${media.kind}: [${clean(media.sourcePart)}](${origin}/api/assets/${media.assetId})`,
        `Slides: ${media.unitNumbers.join(', ') || 'Unplaced resource'} · Preview: ${media.previewOrigin}`,
        '',
        ...media.warnings.map((w) => `- ${clean(w)}`),
        '',
      );
      for (const ref of media.previewIds) {
        const p = stage.primitives.find((p) => p.id === ref);
        if (p?.kind === 'image')
          lines.push(
            `<a id="frame-${ref}"></a>`,
            ...(p.actualMs !== null ? [`Clip frame at ${p.actualMs} ms`] : []),
            `![${clean(label?.label ?? media.sourcePart)}](${origin}/api/assets/${p.assetId})`,
            '',
          );
      }
    }
    if (stage.document.transform)
      lines.push(
        '## Image orientation',
        '',
        JSON.stringify(stage.document.transform),
        '',
      );
    return lines.join('\n');
  }
  lines.push('## Transcript / extracted text', '');
  for (const p of stage.primitives)
    if (p.kind === 'text') {
      const time =
        p.locator.kind === 'media'
          ? ` [${(p.locator.startMs / 1000).toFixed(2)}–${(p.locator.endMs / 1000).toFixed(2)}s]`
          : '';
      lines.push(
        `<a id="text-${p.id}"></a>`,
        `${p.speaker ? `**${clean(p.speaker)}**` : ''}${time}`,
        p.text,
        '',
      );
    }
  if (stage.context) {
    lines.push(
      '## Transcript questions and frame searches',
      '',
      `Read ${stage.context.readSegments}/${stage.context.totalSegments} speech segments · ${clean(stage.context.model)} · ${clean(stage.context.promptVersion)}`,
      '',
    );
    for (const q of stage.context.questions) {
      lines.push(
        `### ${clean(q.question)}`,
        '',
        `${q.status} · ${q.purpose}`,
        q.explanation,
        ...q.transcriptIds.map(
          (ref) => `Related speech: [${ref}](#text-${ref})`,
        ),
        ...q.searches.flatMap((search) => [
          `Search: ${clean(search.reason)} · ${search.timesMs.join(', ')} ms`,
          ...search.frameIds.map((ref) => `Frame: [${ref}](#frame-${ref})`),
        ]),
        '',
      );
    }
  }
  if (stage.speakerSuggestions?.length) {
    lines.push(
      '## Tentative speaker names',
      '',
      'These are unverified model suggestions. Original speaker codes are preserved.',
      '',
    );
    for (const s of stage.speakerSuggestions.filter((s) =>
      isUsableCandidateName(s.candidateName),
    ))
      lines.push(
        `**${clean(s.speaker)}** → possibly **${clean(s.candidateName)}** (${s.confidence}; ${s.basis})`,
        s.reason,
        ...s.transcriptIds.map(
          (ref) => `Related speech: [${ref}](#text-${ref})`,
        ),
        ...s.frameIds.map((ref) => `Frame: [${ref}](#frame-${ref})`),
        `Model: ${clean(s.model)} · Prompt: ${clean(s.promptVersion)}`,
        '',
      );
  }
  lines.push('## Visual context (model observations)', '');
  for (const a of stage.annotations) {
    lines.push(
      a.text,
      `Model: ${clean(a.model)} · Prompt: ${clean(a.promptVersion)}`,
      ...a.transcriptIds.map((ref) => `Related speech: [${ref}](#text-${ref})`),
      ...a.frameIds.map((ref) => `Frame: [${ref}](#frame-${ref})`),
      '',
    );
  }
  lines.push('## Referenced frames', '');
  for (const p of stage.primitives)
    if (p.kind === 'image')
      lines.push(
        `<a id="frame-${p.id}"></a>`,
        `Requested ${p.requestedMs} ms · actual ${p.actualMs} ms`,
        `![Frame ${p.id}](${origin}/api/assets/${p.assetId})`,
        '',
      );
  return lines.join('\n');
}
