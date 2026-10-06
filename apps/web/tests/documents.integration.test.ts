import { test, expect, afterAll } from 'bun:test';
import {
  acceptUpload,
  getUpload,
  memoryCount,
  retryUpload,
} from '../src/lib/server/services/uploads';
import { interpret } from '../src/lib/server/agents/interpreter';
import { validateStage } from '../src/lib/server/contracts';
import { sqlClient } from '../src/lib/server/db/client';
import { exportBundle } from '../src/lib/server/services/bundle';
import { unzipSync } from 'fflate';
const enabled = !!process.env.DOCUMENT_FIXTURES;
const check = test.skipIf(!enabled);
afterAll(async () => {
  if (enabled) await sqlClient.end();
});
for (const [filename, path] of [
  ['260629_VLM.pptx', '/fixtures/260629_VLM.pptx'],
  ['ITRI_VLM_Midterm_Report.pdf', '/fixtures/ITRI_VLM_Midterm_Report.pdf'],
  ['rotated.jpg', '/data/input/rotated.jpg'],
]) {
  check(
    `real ${filename} becomes source-mapped staging, retries reuse derivatives and never enter memory`,
    async () => {
      const raw = await Bun.file(path).arrayBuffer();
      const item = await acceptUpload(new File([raw], filename), {});
      await interpret(item.runId);
      await interpret(item.runId);
      let detail = await getUpload(item.uploadId);
      expect(detail.revisions).toHaveLength(1);
      const first = validateStage(detail.revisions[0].manifest);
      expect(first.document).toBeDefined();
      expect(first.document!.cached).toBe(false);
      expect(first.primitives.some((p) => p.kind === 'image')).toBe(true);
      expect(
        first.primitives.every(
          (p) => p.kind !== 'text' || (p.role !== 'asr' && p.speaker === null),
        ),
      ).toBe(true);
      if (filename.endsWith('.jpg')) {
        expect(first.document!.transform?.exifOrientation).toBe(6);
        expect(first.coverage.complete).toBe(false);
        expect(
          first.primitives.some((p) => p.kind === 'text' && p.role === 'ocr'),
        ).toBe(true);
      }
      if (filename.endsWith('.pptx')) {
        expect(first.document!.units).toHaveLength(38);
        expect(
          first.primitives.filter(
            (p) => p.kind === 'text' && p.role === 'notes',
          ),
        ).toHaveLength(4);
      }
      const retry = await retryUpload(item.uploadId);
      await interpret(retry);
      detail = await getUpload(item.uploadId);
      expect(detail.revisions).toHaveLength(2);
      const latest = validateStage(
        detail.revisions.find((r) => r.id === detail.upload.currentRevisionId)!
          .manifest,
      );
      expect(latest.parentRevisionId).toBe(first.id);
      expect(latest.document!.cached).toBe(true);
      expect(
        latest.primitives
          .filter((p) => p.kind === 'image')
          .map((p) => p.assetId),
      ).toEqual(
        first.primitives
          .filter((p) => p.kind === 'image')
          .map((p) => p.assetId),
      );
      const files = unzipSync(await exportBundle(latest, filename));
      expect(files['document.md']).toBeDefined();
      expect(files['extracted-text.md']).toBeDefined();
      expect(
        Object.keys(files).filter((f) => f.startsWith('images/')),
      ).toHaveLength(latest.document!.units.length);
      expect(await memoryCount()).toBe(0);
    },
    60000,
  );
}
