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
import { correctStage } from '../src/lib/server/services/staging';
const enabled = process.env.TEST_SUITE === 'documents';
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
      ).toHaveLength(
        latest.primitives.filter((p) => p.kind === 'image').length,
      );
      expect(
        Object.keys(files).filter((f) => f.startsWith('media/')),
      ).toHaveLength(latest.document!.media?.length ?? 0);
      expect(await memoryCount()).toBe(0);
      if (filename.endsWith('.pptx')) {
        // Exercise the actual SDK/worker lifecycle against a deterministic local model server.
        const server = Bun.serve({
          port: 0,
          async fetch(request) {
            const body = (await request.json()) as any;
            const refs = body.messages[1].content
              .filter((p: any) => p.type === 'text')
              .slice(1)
              .map((p: any) => p.text.split('\n')[0]);
            const content = JSON.stringify(
              refs.length
                ? {
                    labels: refs.map((ref: string) => ({
                      ref,
                      label: 'Research source comparison',
                      description:
                        'The source shows research methods and reported comparisons.',
                    })),
                  }
                : {
                    summary:
                      'The source presents research methods and comparisons.',
                    evidenceRefs: ['U1'],
                  },
            );
            return Response.json({
              id: 'local-review',
              object: 'chat.completion',
              model: 'local-review',
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: { role: 'assistant', content },
                },
              ],
            });
          },
        });
        const previous = {
          key: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
          url: process.env.OPENAI_BASE_URL,
        };
        process.env.OPENAI_API_KEY = 'local-regression';
        process.env.OPENAI_MODEL = 'local-review';
        process.env.OPENAI_BASE_URL = `${server.url}v1`;
        try {
          const revisit = await retryUpload(item.uploadId, latest.id);
          await interpret(revisit);
          detail = await getUpload(item.uploadId);
          const described = validateStage(
            detail.revisions.find(
              (r) => r.id === detail.upload.currentRevisionId,
            )!.manifest,
          );
          expect(described.document!.review!.complete).toBe(true);
          expect(described.primitives).toEqual(latest.primitives);
          expect(described.document!.media).toEqual(latest.document!.media);
          expect(described.provenance.adapter).toBe(
            'document-review-revisit-1',
          );
          const primitive = described.primitives.find(
            (p) => p.kind === 'text',
          )!;
          const corrected = await correctStage(item.uploadId, {
            baseRevisionId: described.id,
            label: 'Corrected deck',
            sourceTime: null,
            edits: [
              {
                primitiveId: primitive.id,
                text: 'Corrected source wording',
                speaker: null,
              },
            ],
          });
          expect(corrected.document!.review).toBeUndefined();
          expect(
            corrected.primitives.find(
              (p) => p.id === primitive.id && p.kind === 'text',
            )!.kind,
          ).toBe('text');
          expect(
            (await getUpload(item.uploadId)).revisions.find(
              (r) => r.id === described.id,
            )!.manifest.document!.review!.summary,
          ).toBeDefined();
          await expect(
            retryUpload(item.uploadId, described.id),
          ).rejects.toThrow('Staging changed');
          const refreshed = await retryUpload(item.uploadId, corrected.id);
          await interpret(refreshed);
          detail = await getUpload(item.uploadId);
          const reviewed = validateStage(
            detail.revisions.find(
              (r) => r.id === detail.upload.currentRevisionId,
            )!.manifest,
          );
          expect(reviewed.primitives).toEqual(corrected.primitives);
          expect(reviewed.document!.review!.complete).toBe(true);
          expect(await memoryCount()).toBe(0);
        } finally {
          server.stop(true);
          process.env.OPENAI_API_KEY = previous.key ?? '';
          process.env.OPENAI_MODEL = previous.model ?? '';
          process.env.OPENAI_BASE_URL = previous.url ?? '';
        }
      }
    },
    60000,
  );
}
