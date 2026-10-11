import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import type { Stage } from '../../src/lib/server/contracts';

type Detail = {
  upload: { id: string; filename: string; currentRevisionId: string };
  asset: { id: string };
  revisions: { id: string; manifest: Stage }[];
  memory: unknown;
};

async function source(page: Page, accepts: (stage: Stage) => boolean) {
  const response = await page.request.get('/api/uploads');
  expect(response.ok()).toBe(true);
  const uploads: {
    id: string;
    filename: string;
    run: { state: string } | null;
  }[] = await response.json();
  const candidates = uploads.filter((upload) =>
    ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
  );
  candidates.sort(
    (a, b) =>
      Number(/Real2Sim.*part[_ -]?0?2/i.test(b.filename)) -
      Number(/Real2Sim.*part[_ -]?0?2/i.test(a.filename)),
  );
  for (const candidate of candidates) {
    const detail: Detail = await (
      await page.request.get(`/api/uploads/${candidate.id}`)
    ).json();
    const stage = detail.revisions.find(
      (revision) => revision.id === detail.upload.currentRevisionId,
    )?.manifest;
    if (stage && accepts(stage)) return { detail, stage };
  }
  return undefined;
}

async function unchanged(page: Page, before: Detail) {
  const after: Detail = await (
    await page.request.get(`/api/uploads/${before.upload.id}`)
  ).json();
  expect(after.upload.currentRevisionId).toBe(before.upload.currentRevisionId);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.memory).toEqual(before.memory);
}

test('frame previews stay in the review page, fit the viewport, and restore keyboard focus', async ({
  page,
  context,
}) => {
  const meeting = await source(
    page,
    (stage) => !stage.document && stage.annotations.length > 0,
  );
  test.skip(
    !meeting,
    'No processed recording with visual frame evidence is available.',
  );
  if (!meeting) return;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `/staging/${meeting.detail.upload.id}?revision=${meeting.stage.id}`,
  );
  const originalUrl = page.url();
  let newPages = 0;
  context.on('page', () => newPages++);
  const gallery = page.locator('.observation-card .gallery').first();
  const openFrame = gallery.getByRole('button', {
    name: 'Open frame',
    exact: true,
  });
  const activeFrame = gallery.locator('button[data-current="true"]');
  const frameSrc = await activeFrame.locator('img').getAttribute('src');
  await openFrame.click();
  const dialog = page.getByRole('dialog', {
    name: 'Media preview',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.preview-media img')).toHaveAttribute(
    'src',
    frameSrc!,
  );
  await expect(
    dialog.getByRole('button', { name: 'Close media preview', exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole('link', { name: 'Download original media', exact: true }),
  ).toHaveAttribute('href', frameSrc!);
  await expect
    .poll(() =>
      dialog
        .locator('.preview-surface')
        .evaluate(
          (element) => element.getBoundingClientRect().width / innerWidth,
        ),
    )
    .toBeCloseTo(0.8, 2);
  expect(page.url()).toBe(originalUrl);
  expect(newPages).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(openFrame).toBeFocused();

  // Dismiss during the entering motion to cover interruptible close behavior.
  await activeFrame.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).not.toBeVisible();
  await expect(activeFrame).toBeFocused();
  expect(newPages).toBe(0);
  await unchanged(page, meeting.detail);
});

test('mobile reduced-motion frame previews keep gallery keyboard navigation and close without animation', async ({
  page,
}) => {
  const meeting = await source(
    page,
    (stage) => !stage.document && stage.annotations.length > 0,
  );
  test.skip(
    !meeting,
    'No processed recording with visual frame evidence is available.',
  );
  if (!meeting) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `/staging/${meeting.detail.upload.id}?revision=${meeting.stage.id}`,
  );
  const gallery = page.locator('.observation-card .gallery').first();
  const activeFrame = gallery.locator('button[data-current="true"]');
  await activeFrame.focus();
  if (
    await gallery
      .getByRole('button', { name: 'Next frame', exact: true })
      .count()
  ) {
    await page.keyboard.press('ArrowRight');
    await expect(gallery.locator('.counter')).toHaveText(/2\s*\/\s*\d+/);
    await expect(activeFrame).toBeFocused();
  }
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Media preview',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
    ),
  ).toBe(0);
  expect(
    await dialog
      .locator('.preview-surface')
      .evaluate(
        (element) => element.getBoundingClientRect().width / innerWidth,
      ),
  ).toBeCloseTo(0.92, 2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await dialog
    .getByRole('button', { name: 'Close media preview', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(activeFrame).toBeFocused();
  await unchanged(page, meeting.detail);
});

test('Original opens a video in-page and closing pauses its player before removing the preview', async ({
  page,
  context,
}) => {
  const meeting = await source(
    page,
    (stage) => !stage.document && stage.provenance.adapter.startsWith('video'),
  );
  test.skip(!meeting, 'No processed original meeting video is available.');
  if (!meeting) return;
  await page.goto(
    `/staging/${meeting.detail.upload.id}?revision=${meeting.stage.id}`,
  );
  const original = page
    .locator('.review-header')
    .getByRole('button', { name: 'Original', exact: true });
  const originalPlayer = page.locator('#original-evidence video');
  await expect
    .poll(() =>
      originalPlayer.evaluate(
        (element: HTMLVideoElement) => element.readyState,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  const startingTime = await originalPlayer.evaluate(
    (element: HTMLVideoElement) => {
      element.currentTime = Math.min(10, element.duration / 2);
      return element.currentTime;
    },
  );
  let newPages = 0;
  context.on('page', () => newPages++);
  await original.click();
  const dialog = page.getByRole('dialog', {
    name: 'Media preview',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const player = dialog.locator('video');
  await expect(player).toHaveAttribute(
    'src',
    `/api/assets/${meeting.detail.asset.id}`,
  );
  await expect
    .poll(() =>
      player.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() =>
      player.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeCloseTo(startingTime, 1);
  await player.evaluate((element: HTMLVideoElement) => {
    element.currentTime = Math.min(element.currentTime + 5, element.duration);
  });
  await expect(
    dialog.getByRole('link', { name: 'Download original media', exact: true }),
  ).toHaveAttribute('href', `/api/assets/${meeting.detail.asset.id}`);
  const handle = await player.elementHandle();
  if (!handle) throw new Error('Preview video did not mount');
  await handle.evaluate((element) => {
    const video = element as HTMLVideoElement;
    const nativePause = video.pause.bind(video);
    video.pause = () => {
      video.dataset.pauseCalls = String(
        Number(video.dataset.pauseCalls ?? 0) + 1,
      );
      nativePause();
    };
    video.muted = true;
    void video.play().catch(() => {});
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(
    await handle.evaluate((element) => (element as HTMLVideoElement).paused),
  ).toBe(true);
  expect(
    await handle.evaluate((element) =>
      Number((element as HTMLVideoElement).dataset.pauseCalls ?? 0),
    ),
  ).toBeGreaterThan(0);
  const endingTime = await handle.evaluate(
    (element) => (element as HTMLVideoElement).currentTime,
  );
  await expect
    .poll(() =>
      originalPlayer.evaluate(
        (element: HTMLVideoElement) => element.currentTime,
      ),
    )
    .toBeCloseTo(endingTime, 1);
  await expect(original).toBeFocused();
  await original.click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog
      .locator('video')
      .evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(true);
  await page.mouse.click(4, 4);
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() =>
      originalPlayer.evaluate(
        (element: HTMLVideoElement) => element.currentTime,
      ),
    )
    .toBeCloseTo(endingTime, 1);
  expect(newPages).toBe(0);
  await unchanged(page, meeting.detail);
});

test('document source renders use the same in-page preview and retain source evidence anchors', async ({
  page,
  context,
}) => {
  const document = await source(page, (stage) =>
    Boolean(stage.document?.units.length),
  );
  test.skip(!document, 'No processed document or image source is available.');
  if (!document) return;
  await page.goto(
    `/staging/${document.detail.upload.id}?revision=${document.stage.id}`,
  );
  const render = page.locator('.document-viewer .render-link');
  const frameId = await render.getAttribute('id');
  const imageSrc = await render.locator('img').getAttribute('src');
  let newPages = 0;
  context.on('page', () => newPages++);
  await render.click();
  const dialog = page.getByRole('dialog', {
    name: 'Media preview',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.preview-media img')).toHaveAttribute(
    'src',
    imageSrc!,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(render).toBeFocused();
  await expect(render).toHaveAttribute('id', frameId!);
  expect(newPages).toBe(0);
  await unchanged(page, document.detail);
});

test('document previews cannot execute uploaded HTML scripts or access the app origin', async ({
  page,
}) => {
  const document = await source(
    page,
    (stage) => stage.document?.format === 'pdf',
  );
  test.skip(
    !document,
    'No processed PDF is available to exercise the document iframe preview.',
  );
  if (!document) return;
  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      if (event.data === 'untrusted-preview-script-executed')
        window.document.documentElement.dataset.previewScriptExecuted = 'yes';
    });
  });
  await page.route(`**/api/assets/${document.detail.asset.id}`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><p>Untrusted preview bytes.</p><script>parent.postMessage("untrusted-preview-script-executed", "*");</script>',
    }),
  );
  await page.goto(
    `/staging/${document.detail.upload.id}?revision=${document.stage.id}`,
  );
  await page
    .locator('.review-header')
    .getByRole('button', { name: 'Original', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Media preview',
    exact: true,
  });
  const iframe = dialog.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error('Document preview iframe did not mount');
  await frame.waitForLoadState('load');
  await expect(
    frame.getByText('Untrusted preview bytes.', { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => window.document.documentElement.dataset.previewScriptExecuted,
    ),
  ).toBeUndefined();
  expect(
    await iframe.evaluate(
      (element: HTMLIFrameElement) => element.contentDocument,
    ),
  ).toBeNull();
  await expect(
    dialog.getByText('Use Download if this document does not display.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await unchanged(page, document.detail);
});
