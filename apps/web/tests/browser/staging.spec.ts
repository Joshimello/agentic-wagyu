import { test, expect, type Page } from '@playwright/test';
import corpus from '../../../../evals/meetings.json';
import type { Primitive, Stage } from '../../src/lib/server/contracts';
import { isUsableCandidateName } from '../../src/lib/speaker-names';

type Upload = { id: string; filename: string; run: { state: string } | null };
type Detail = {
  upload: { id: string; currentRevisionId: string };
  revisions: { id: string; manifest: Stage }[];
  memory: { state: string; commitVersion: number | null };
};

async function inspectRecording(page: Page, video: Upload) {
  const before: Detail = await (
    await page.request.get(`/api/uploads/${video.id}`)
  ).json();
  const stage = before.revisions.find(
    (revision) => revision.id === before.upload.currentRevisionId,
  )?.manifest;
  expect(stage).toBeTruthy();
  if (!stage) throw new Error('Ready meeting has no current evidence revision');
  const texts = stage.primitives.filter(
    (p): p is Extract<Primitive, { kind: 'text' }> => p.kind === 'text',
  );

  await page.goto(`/staging/${video.id}?revision=${stage.id}`);
  await expect(
    page.getByRole('heading', { name: 'Spoken transcript', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.memory-status')).toContainText(
    before.memory.state === 'never_pushed'
      ? 'Not in memory'
      : before.memory.state.replaceAll('_', ' '),
  );
  await expect(page.locator('.preview-turn')).toHaveCount(
    Math.min(4, texts.length),
  );
  const player = page.locator('video');
  await expect(player).toBeVisible();
  await expect
    .poll(() =>
      player.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(player.locator('track')).toHaveAttribute(
    'src',
    `/api/uploads/${video.id}/captions?revision=${stage.id}`,
  );

  const spoken = texts.find(
    (p) =>
      p.locator.kind === 'media' &&
      p.locator.startMs > 0 &&
      texts.indexOf(p) < 4,
  );
  if (spoken?.locator.kind === 'media') {
    await page
      .locator('.preview-turn')
      .nth(texts.indexOf(spoken))
      .getByRole('button')
      .click();
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeCloseTo(spoken.locator.startMs / 1000, 1);
  }

  if (stage.annotations.length) {
    const gallery = page.locator('.observation-card .gallery').first();
    await expect(gallery).toBeVisible();
    const image = gallery.locator('a[data-current="true"] img');
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    if (
      await gallery
        .getByRole('button', { name: 'Next frame', exact: true })
        .count()
    ) {
      await gallery
        .getByRole('button', { name: 'Next frame', exact: true })
        .click();
      await expect(gallery.locator('.counter')).toHaveText(/2\s*\/\s*\d+/);
      await expect(gallery.locator('.thumbnail').nth(1)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
    const frameTime = (await gallery.locator('.capture-time').innerText())
      .trim()
      .split(':')
      .reduce((seconds, value) => seconds * 60 + Number(value), 0);
    await gallery.locator('.capture-time').click();
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeCloseTo(frameTime, 1);

    const speechLink = page.locator('.observation-card .evidence-link').first();
    if (await speechLink.count()) {
      await speechLink.click();
      const dialog = page.getByRole('dialog', { name: 'Full transcript' });
      await expect(dialog).toBeVisible();
      const highlighted = dialog.locator('.reader-turn.highlighted');
      await expect(highlighted).toHaveCount(1);
      const primitiveId = (await highlighted.getAttribute('id'))!.slice(
        'text-'.length,
      );
      expect(
        stage.annotations.some((annotation) =>
          annotation.transcriptIds.includes(primitiveId),
        ),
      ).toBe(true);
      await expect(highlighted).toBeFocused();
      await expect(highlighted.locator('p')).toHaveText(
        texts.find((primitive) => primitive.id === primitiveId)!.text,
      );
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  }

  const suggestions =
    stage.speakerSuggestions?.filter((suggestion) =>
      isUsableCandidateName(suggestion.candidateName),
    ) ?? [];
  if (suggestions.length) {
    await page
      .getByRole('button', {
        name: `Speaker suggestions (${suggestions.length})`,
        exact: true,
      })
      .click();
    await expect(page.locator('.speaker-notes')).toContainText(
      'Original speaker labels stay separate.',
    );
    await expect(page.locator('.suggestion-heading').first()).toContainText(
      suggestions[0].speaker,
    );
    await page
      .getByRole('button', {
        name: `Speaker suggestions (${suggestions.length})`,
        exact: true,
      })
      .click();
  }

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const markdown = page.getByRole('link', { name: 'Markdown', exact: true });
  const exportUrl = await markdown.getAttribute('href');
  expect(exportUrl).toContain(`revision=${stage.id}`);
  const exported = await page.request.get(exportUrl!);
  expect(exported.ok()).toBe(true);
  const output = await exported.text();
  expect(output).toContain('## Transcript / extracted text');
  expect(output).toContain('## Visual context');
  if (texts[0]?.text)
    expect(output).toContain(texts[0].text.replaceAll('\r', ''));
  await page.keyboard.press('Escape');
  const original = await page
    .getByRole('link', { name: 'Original', exact: true })
    .getAttribute('href');
  const raw = await page.request.get(original!, {
    headers: { Range: 'bytes=0-31' },
  });
  expect(raw.status()).toBe(206);
  expect((await raw.body()).byteLength).toBe(32);

  const after: Detail = await (
    await page.request.get(`/api/uploads/${video.id}`)
  ).json();
  expect(after.upload.currentRevisionId).toBe(before.upload.currentRevisionId);
  expect(after.revisions.length).toBe(before.revisions.length);
  expect(after.memory).toEqual(before.memory);
}

for (const recording of corpus.recordings) {
  test(`inspect ${recording.filename}, seek linked evidence and export without mutating the meeting`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Your evidence, ready for review.' }),
    ).toBeVisible();
    const uploads: Upload[] = await (
      await page.request.get('/api/uploads')
    ).json();
    const video = uploads.find(
      (upload) =>
        upload.filename === recording.filename &&
        ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
    );
    test.skip(
      !video,
      `${recording.filename} is not a processed source on this PC; dynamic ready-video coverage runs separately.`,
    );
    await inspectRecording(page, video!);
  });
}

test('inspect an available processed meeting with linked frames and pinned exports', async ({
  page,
}) => {
  const uploads: Upload[] = await (
    await page.request.get('/api/uploads')
  ).json();
  const candidates = uploads.filter(
    (upload) =>
      /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename) &&
      ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
  );
  const video =
    candidates.find((upload) =>
      /Real2Sim.*part[_ -]?0?2/i.test(upload.filename),
    ) ?? candidates[0];
  test.skip(
    !video,
    'No processed meeting recording is available for local browser review.',
  );
  await inspectRecording(page, video!);
});
