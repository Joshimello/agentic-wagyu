import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { uploads, revisions } from '../db/schema';
import { validateStage, id, type Stage } from '../contracts';
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
    stage.id = crypto.randomUUID();
    stage.parentRevisionId = base.id;
    stage.createdAt = new Date().toISOString();
    if (
      new Set(correction.edits.map((e) => e.primitiveId)).size !==
      correction.edits.length
    )
      throw new Error('Duplicate correction');
    for (const edit of correction.edits) {
      const p = stage.primitives.find((p) => p.id === edit.primitiveId);
      if (!p || p.kind !== 'text')
        throw new Error('Correction refers to missing text');
      p.text = edit.text;
      p.speaker = edit.speaker;
    }
    stage.metadata.label = correction.label;
    stage.metadata.sourceTime = correction.sourceTime;
    stage.metadata.sourceTimeOrigin = correction.sourceTime
      ? 'user'
      : 'unknown';
    stage.provenance.adapter = 'user-correction-1';
    if (correction.edits.length && stage.annotations.length)
      stage.coverage.warnings.push(
        'Visual annotations were retained from the previous revision; review them after text corrections.',
      );
    validateStage(stage);
    await tx
      .insert(revisions)
      .values({
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
