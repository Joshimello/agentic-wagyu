import { z } from 'zod';
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
    mime: z.literal('image/jpeg'),
  })
  .strict();
const responseSchema = z
  .object({
    adapter: z.literal('documents-2'),
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
    transform: stageSchema.shape.document.unwrap().shape.transform,
    tools: z.record(z.string(), z.string()),
    elapsedMs: z.number().int().nonnegative(),
    cached: z.boolean(),
  })
  .strict();
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
    const file = Bun.file(assetPath(unit.render.storageKey));
    const hash = new Bun.CryptoHasher('sha256')
      .update(await file.arrayBuffer())
      .digest('hex');
    if (
      file.size !== unit.render.bytes ||
      hash !== unit.render.sha256 ||
      unit.render.storageKey !== `assets/${hash.slice(0, 2)}/${hash}`
    )
      throw new Error('Document render integrity mismatch');
    await db
      .insert(assets)
      .values({ id: crypto.randomUUID(), ...unit.render })
      .onConflictDoNothing({ target: assets.sha256 });
    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.sha256, unit.render.sha256));
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
  stage.document = {
    format,
    units,
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
  await progress(
    `Prepared ${units.length} ${format === 'pptx' ? 'slides' : format === 'pdf' ? 'pages' : 'image'} for review`,
  );
}
