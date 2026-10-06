/** Read-only document acceptance on the supplied corpus. */
import corpus from '../../../evals/documents.json';
import { validateStage } from '../src/lib/server/contracts';
import { unzipSync, strFromU8 } from 'fflate';
import { config } from '../src/lib/server/config';
import { memoryCount } from '../src/lib/server/services/uploads';
import { sqlClient } from '../src/lib/server/db/client';
const url = process.env.WEB_URL ?? 'http://web:5173';
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
try {
  const memoryBefore = await memoryCount();
  const uploads = await (await fetch(`${url}/api/uploads`)).json();
  const reports = [];
  for (const item of corpus.documents) {
    const upload = uploads.find((u: any) => u.filename === item.filename);
    assert(upload, `Import ${item.filename} first`);
    assert(
      ['ready', 'ready_with_warnings'].includes(upload.run.state),
      `${item.filename}: ${upload.run.state}`,
    );
    const before = await (
      await fetch(`${url}/api/uploads/${upload.id}`)
    ).json();
    const stage = validateStage(
      before.revisions.find(
        (r: any) => r.id === before.upload.currentRevisionId,
      ).manifest,
    );
    assert(stage.document?.format === item.format, 'Document format mismatch');
    assert(before.asset.sha256 === item.sha256, 'Raw source hash mismatch');
    const raw = await (
      await fetch(`${url}/api/assets/${stage.rawAssetId}`)
    ).arrayBuffer();
    assert(
      new Bun.CryptoHasher('sha256').update(raw).digest('hex') === item.sha256,
      'Raw source was changed',
    );
    if ('units' in item)
      assert(
        stage.document!.units.length === item.units,
        'Missing original slides',
      );
    let native = 0,
      notes = 0,
      ocr = 0;
    for (const unit of stage.document!.units) {
      const render = stage.primitives.find((p) => p.id === unit.renderId);
      assert(render?.kind === 'image', 'Missing render');
      if (render?.kind === 'image') {
        const response = await fetch(`${url}/api/assets/${render.assetId}`);
        assert(
          response.ok && response.headers.get('content-type') === 'image/jpeg',
          'Unavailable page/slide render',
        );
      }
      for (const ref of unit.textIds) {
        const p = stage.primitives.find((p) => p.id === ref);
        assert(
          p?.kind === 'text' && p.role !== 'asr' && p.speaker === null,
          'Document text attributed as speech',
        );
        if (p?.kind === 'text') {
          if (p.role === 'native') native++;
          if (p.role === 'notes') notes++;
          if (p.role === 'ocr') ocr++;
        }
      }
    }
    assert(native > 0, 'No native document text');
    if ('notes' in item)
      assert(notes === item.notes, 'Speaker notes were lost or misclassified');
    const exported = validateStage(
      await (
        await fetch(
          `${url}/api/uploads/${upload.id}/export?revision=${stage.id}&format=json`,
        )
      ).json(),
    );
    assert(
      Bun.deepEquals(exported, stage),
      'Pinned JSON export changed evidence',
    );
    const bundle = unzipSync(
      new Uint8Array(
        await (
          await fetch(
            `${url}/api/uploads/${upload.id}/export?revision=${stage.id}&format=zip`,
          )
        ).arrayBuffer(),
      ),
    );
    assert(
      bundle['document.md'] &&
        bundle['extracted-text.md'] &&
        bundle['staging.json'],
      'Document bundle incomplete',
    );
    const md = strFromU8(bundle['document.md']);
    assert(
      !md.includes('http://localhost:5173/api/assets/'),
      'Non-portable document bundle',
    );
    assert(
      Object.keys(bundle).filter((f) => f.startsWith('images/')).length ===
        stage.document!.units.length,
      'Missing bundled renders',
    );
    assert(
      !Object.keys(bundle).some((f) => /\.(pptx|pdf)$/i.test(f)),
      'Original should not be duplicated in export',
    );
    const after = await (await fetch(`${url}/api/uploads/${upload.id}`)).json();
    assert(
      before.upload.currentRevisionId === after.upload.currentRevisionId &&
        before.revisions.length === after.revisions.length,
      'Evaluation changed staging',
    );
    const report = {
      filename: item.filename,
      uploadId: upload.id,
      revisionId: stage.id,
      units: stage.document!.units.length,
      native,
      notes,
      ocr,
      hidden: stage.document!.units.filter((u) => u.hidden).length,
      complete: stage.coverage.complete,
      warningCount: stage.coverage.warnings.length,
      elapsedMs: stage.document!.elapsedMs,
      cached: stage.document!.cached,
    };
    reports.push(report);
    console.log(JSON.stringify(report));
  }
  const health = await (await fetch(`${url}/api/health`)).json();
  assert(health.ok, 'Application unhealthy');
  const memoryAfter = await memoryCount();
  assert(
    memoryAfter === memoryBefore,
    'Document processing or evaluation changed memory',
  );
  await Bun.write(
    `${config.dataRoot}/evaluations/documents.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        documents: reports,
        memoryBefore,
        memoryAfter,
      },
      null,
      2,
    ),
  );
  console.log(
    'Document corpus mapping, raw hashes, staging and portable exports passed.',
  );
} finally {
  await sqlClient.end();
}
