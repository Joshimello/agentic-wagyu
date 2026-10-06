import { z } from 'zod';
import { enrichDocument } from './document-review';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { assets } from '../../db/schema';
import { config } from '../../config';
import { assetPath } from '../../storage';
import {
  bounds,
  stageSchema,
  type Stage,
  type Primitive,
} from '../../contracts';
const derivedAsset = z
  .object({
    storageKey: z.string().regex(/^assets\/[a-f0-9]{2}\/[a-f0-9]{64}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
    mime: z.string().min(1),
  })
  .strict();
const responseSchema = z
  .object({
    adapter: z.literal('documents-3'),
    format: z.enum(['pdf', 'pptx', 'image']),
    units: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            hidden: z.boolean(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            texts: z.array(
              z
                .object({
                  role: z.enum(['native', 'notes', 'ocr']),
                  text: z.string(),
                  bounds: bounds.nullable(),
                })
                .strict(),
            ),
            render: derivedAsset,
            complete: z.boolean(),
            warnings: z.array(z.string()),
          })
          .strict(),
      )
      .min(1)
      .max(400),
    warnings: z.array(z.string()),
    media: z.array(
      z
        .object({
          sourcePart: z.string(),
          kind: z.enum(['image', 'video']),
          original: derivedAsset,
          unitNumbers: z.array(z.number().int().positive()),
          previewSourceUnit: z.number().int().positive().nullable(),
          previewOrigin: z.enum([
            'decoded_image',
            'video_frames',
            'slide_crop',
            'unavailable',
          ]),
          previews: z.array(
            z
              .object({
                asset: derivedAsset,
                width: z.number().int().positive(),
                height: z.number().int().positive(),
                requestedMs: z.number().int().nonnegative().nullable(),
                actualMs: z.number().int().nonnegative().nullable(),
              })
              .strict(),
          ),
          durationMs: z.number().int().nonnegative().nullable(),
          warnings: z.array(z.string()),
        })
        .strict(),
    ),
    transform: stageSchema.shape.document.unwrap().shape.transform,
    tools: z.record(z.string(), z.string()),
    elapsedMs: z.number().int().nonnegative(),
    cached: z.boolean(),
  })
  .strict();
async function registerDocumentAsset(value: z.infer<typeof derivedAsset>) {
  const file = Bun.file(assetPath(value.storageKey));
  const hash = new Bun.CryptoHasher('sha256')
    .update(await file.arrayBuffer())
    .digest('hex');
  if (
    file.size !== value.bytes ||
    hash !== value.sha256 ||
    value.storageKey !== `assets/${hash.slice(0, 2)}/${hash}`
  )
    throw new Error('Document asset integrity mismatch');
  await db
    .insert(assets)
    .values({ id: crypto.randomUUID(), ...value })
    .onConflictDoNothing({ target: assets.sha256 });
  const [asset] = await db
    .select()
    .from(assets)
    .where(eq(assets.sha256, value.sha256));
  return asset;
}
export function documentFormat(
  filename: string,
): 'pdf' | 'pptx' | 'image' | null {
  if (/\.pdf$/i.test(filename)) return 'pdf';
  if (/\.pptx$/i.test(filename)) return 'pptx';
  if (/\.(png|jpe?g|webp|tiff?|bmp)$/i.test(filename)) return 'image';
  return null;
}
export async function buildDocument(
  stage: Stage,
  storageKey: string,
  format: 'pdf' | 'pptx' | 'image',
  progress: (message: string) => Promise<void>,
) {
  await progress(
    `Extracting ${format === 'image' ? 'image and OCR' : format === 'pptx' ? 'slide text, notes and renders' : 'page text and renders'}`,
  );
  const response = await fetch(`${config.mediaUrl}/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storageKey, format }),
    signal: AbortSignal.timeout(1800000),
  });
  const raw = await response.json();
  if (!response.ok)
    throw new Error(
      typeof raw.detail === 'string'
        ? raw.detail
        : 'Document extraction failed',
    );
  const result = responseSchema.parse(raw);
  if (result.format !== format) throw new Error('Document format mismatch');
  const units: NonNullable<Stage['document']>['units'] = [];
  for (const unit of result.units) {
    const asset = await registerDocumentAsset(unit.render);
    const locator: Primitive['locator'] =
      format === 'pdf'
        ? { kind: 'page', page: unit.number }
        : format === 'pptx'
          ? { kind: 'slide', slide: unit.number }
          : { kind: 'image', width: unit.width, height: unit.height };
    const renderId = crypto.randomUUID(),
      textIds: string[] = [];
    stage.primitives.push({
      id: renderId,
      kind: 'image',
      role:
        format === 'pdf' ? 'page' : format === 'pptx' ? 'slide' : 'original',
      assetId: asset.id,
      requestedMs: null,
      actualMs: null,
      locator,
    });
    for (const text of unit.texts) {
      const id = crypto.randomUUID();
      textIds.push(id);
      stage.primitives.push({
        id,
        kind: 'text',
        ...text,
        speaker: null,
        locator,
      });
    }
    units.push({
      number: unit.number,
      hidden: unit.hidden,
      width: unit.width,
      height: unit.height,
      textIds,
      renderId,
      complete: unit.complete,
      warnings: unit.warnings,
    });
  }
  const media: NonNullable<Stage['document']>['media'] = [];
  for (const item of result.media) {
    const asset = await registerDocumentAsset(item.original),
      id = crypto.randomUUID(),
      previewIds: string[] = [];
    for (const preview of item.previews) {
      const image = await registerDocumentAsset(preview.asset),
        previewId = crypto.randomUUID();
      previewIds.push(previewId);
      const locator: Primitive['locator'] =
        item.previewSourceUnit !== null
          ? { kind: 'slide', slide: item.previewSourceUnit }
          : { kind: 'image', width: preview.width, height: preview.height };
      stage.primitives.push({
        id: previewId,
        kind: 'image',
        role: item.kind === 'video' ? 'embedded_frame' : 'figure',
        assetId: image.id,
        requestedMs: preview.requestedMs,
        actualMs: preview.actualMs,
        locator,
      });
    }
    media.push({
      id,
      kind: item.kind,
      assetId: asset.id,
      sourcePart: item.sourcePart,
      unitNumbers: item.unitNumbers,
      previewSourceUnit: item.previewSourceUnit,
      previewOrigin: item.previewOrigin,
      previewIds,
      durationMs: item.durationMs,
      warnings: item.warnings,
    });
    for (const unit of units)
      if (item.unitNumbers.includes(unit.number))
        (unit.mediaIds ??= []).push(id);
  }
  stage.document = {
    format,
    units,
    media,
    transform: result.transform,
    tools: result.tools,
    elapsedMs: result.elapsedMs,
    cached: result.cached,
  };
  stage.coverage.complete = units.every((u) => u.complete);
  stage.coverage.warnings = [
    ...result.warnings,
    ...units.flatMap((u) =>
      u.warnings.map(
        (w) => `${format === 'pptx' ? 'Slide' : 'Page'} ${u.number}: ${w}`,
      ),
    ),
  ];
  stage.provenance = {
    adapter: result.adapter,
    model: null,
    modelRevision: null,
    promptVersion: null,
  };
  try {
    await enrichDocument(stage, storageKey, progress);
  } catch {
    delete stage.document.review;
    stage.coverage.warnings.push(
      'Document labels and summary are unavailable; source extraction is preserved. Configure the model and revisit document descriptions.',
    );
  }
  await progress(
    `Prepared ${units.length} ${format === 'pptx' ? 'slides' : format === 'pdf' ? 'pages' : 'image'} for review`,
  );
}
