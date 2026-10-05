/** Import the maintained real-meeting corpus once through the normal upload service. */
import corpus from '../../../evals/meetings.json';
import { acceptUpload } from '../src/lib/server/services/uploads';
import { db, sqlClient } from '../src/lib/server/db/client';
import { assets, uploads } from '../src/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { config } from '../src/lib/server/config';
const report = [];
try {
  for (const recording of corpus.recordings) {
    const file = Bun.file(
      `${config.dataRoot}/recordings/${recording.filename}`,
    );
    const bytes = await file.arrayBuffer();
    const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (sha !== recording.sha256)
      throw new Error(`Recording hash mismatch: ${recording.filename}`);
    const [existing] = await db
      .select({ id: uploads.id })
      .from(uploads)
      .innerJoin(assets, eq(uploads.assetId, assets.id))
      .where(
        and(eq(uploads.filename, recording.filename), eq(assets.sha256, sha)),
      );
    const accepted = existing
      ? { uploadId: existing.id }
      : await acceptUpload(
          new File([bytes], recording.filename, { type: 'video/mp4' }),
          {
            uploader: 'local',
            label: `Meeting ${recording.filename.replace('.mp4', '')}`,
          },
        );
    const item = {
      filename: recording.filename,
      ...accepted,
      alreadyImported: !!existing,
    };
    report.push(item);
    console.log(JSON.stringify(item));
  }
  await Bun.write(
    `${config.dataRoot}/evaluations/imports.json`,
    JSON.stringify(report, null, 2),
  );
} finally {
  await sqlClient.end();
}
