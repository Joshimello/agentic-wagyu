/** Hash-checked import through the ordinary staging service, preserving raw bytes. */
import corpus from '../documents.json';
import { acceptUpload } from '../../apps/web/src/lib/server/services/uploads';
import { db, sqlClient } from '../../apps/web/src/lib/server/db/client';
import { assets, uploads } from '../../apps/web/src/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { config } from '../../apps/web/src/lib/server/config';
const groups = new Map<string, string>();
const report = [];
try {
  for (const item of corpus.documents) {
    const bytes = await Bun.file(
      `${config.dataRoot}/documents/${item.filename}`,
    ).arrayBuffer();
    const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (sha !== item.sha256)
      throw new Error(`Document hash mismatch: ${item.filename}`);
    const stem = item.filename.replace(/\.(pdf|pptx)$/i, '');
    const [existing] = await db
      .select({ id: uploads.id, metadata: uploads.metadata })
      .from(uploads)
      .innerJoin(assets, eq(uploads.assetId, assets.id))
      .where(and(eq(uploads.filename, item.filename), eq(assets.sha256, sha)));
    if (!groups.has(stem))
      groups.set(stem, existing?.metadata.groupId || crypto.randomUUID());
    const result = existing
      ? { uploadId: existing.id }
      : await acceptUpload(
          new File([bytes], item.filename, {
            type:
              item.format === 'pdf'
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          }),
          { uploader: 'local', groupId: groups.get(stem), groupHint: stem },
        );
    const row = {
      filename: item.filename,
      ...result,
      alreadyImported: !!existing,
    };
    report.push(row);
    console.log(JSON.stringify(row));
  }
  await Bun.write(
    `${config.dataRoot}/evaluations/document-imports.json`,
    JSON.stringify(report, null, 2),
  );
} finally {
  await sqlClient.end();
}
