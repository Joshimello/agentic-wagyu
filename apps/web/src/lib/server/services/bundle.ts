import { eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { db } from '../db/client';
import { assets } from '../db/schema';
import { assetPath } from '../storage';
import type { Stage } from '../contracts';
import { exportMarkdown } from './staging';
export async function exportBundle(stage: Stage, filename: string) {
  const files: Record<string, Uint8Array> = {
    'staging.json': strToU8(JSON.stringify(stage, null, 2)),
  };
  let markdown = exportMarkdown(stage, filename, 'http://localhost:5173');
  const rawLine = `Raw file: http://localhost:5173/api/assets/${stage.rawAssetId}`;
  markdown = markdown.replace(
    rawLine,
    `Raw file: ${filename.replace(/[\r\n]/g, ' ')} (original not included)\nRaw asset ID: ${stage.rawAssetId}`,
  );
  for (const p of stage.primitives)
    if (p.kind === 'image') {
      const [asset] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, p.assetId));
      if (!asset) throw new Error('Referenced image unavailable');
      const file = `${stage.document ? 'images' : 'frames'}/${p.id}.jpg`;
      files[file] = new Uint8Array(
        await Bun.file(assetPath(asset.storageKey)).arrayBuffer(),
      );
      markdown = markdown.replaceAll(
        `http://localhost:5173/api/assets/${p.assetId}`,
        file,
      );
    }
  files[stage.document ? 'document.md' : 'transcript-with-visual-context.md'] =
    strToU8(markdown);
  const transcript = {
    ...stage,
    context: undefined,
    speakerSuggestions: undefined,
    annotations: [],
    primitives: stage.primitives.filter((p) => p.kind === 'text'),
  };
  files[stage.document ? 'extracted-text.md' : 'transcript.md'] = strToU8(
    exportMarkdown(transcript, filename, 'http://localhost:5173').replace(
      rawLine,
      `Original: ${filename.replace(/[\r\n]/g, ' ')} (not included)`,
    ),
  );
  return zipSync(files, { level: 6 });
}
