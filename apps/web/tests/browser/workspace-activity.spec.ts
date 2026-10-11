import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import type { Stage } from '../../src/lib/server/contracts';
import type { ActivityTask } from '../../src/lib/activity';

async function meeting(page: Page) {
  const files = await (await page.request.get('/api/uploads')).json();
  for (const file of files.filter(
    (file: any) =>
      /\.(mp4|mov|webm|mkv)$/i.test(file.filename) &&
      ['ready', 'ready_with_warnings'].includes(file.run?.state),
  )) {
    const detail = await (
      await page.request.get(`/api/uploads/${file.id}`)
    ).json();
    const stage: Stage | undefined = detail.revisions.find(
      (revision: any) => revision.id === detail.upload.currentRevisionId,
    )?.manifest;
    if (
      stage &&
      stage.primitives.some(
        (p) =>
          p.kind === 'text' &&
          p.locator.kind === 'media' &&
          p.locator.startMs > 1000,
      )
    )
      return { detail, stage };
  }
  test.skip(true, 'No processed recording is available.');
  throw new Error('No processed recording');
}
async function protectWrites(page: Page) {
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    if (['GET', 'HEAD'].includes(route.request().method()))
      return route.fallback();
    unexpected.push(route.request().url());
    await route.fulfill({
      status: 409,
      json: { error: 'Browser checks never mutate saved evidence.' },
    });
  });
  return unexpected;
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('review layout shows its pinned summary and timestamps start the original video', async ({
  page,
}) => {
  const { detail, stage } = await meeting(page);
  const unexpected = await protectWrites(page);
  const texts = stage.primitives.filter((p) => p.kind === 'text');
  await page.route(`**/api/uploads/${stage.uploadId}/summary?*`, (route) =>
    route.fulfill({
      json: {
        id: '11111111-1111-4111-8111-111111111111',
        revisionId: stage.id,
        generation: 0,
        state: 'ready',
        progressPercent: 100,
        error: null,
        summary: {
          overview: {
            text: 'The meeting reviewed reconstruction results and remaining calibration uncertainty. '.repeat(
              100,
            ),
            evidenceIds: [texts[0].id],
          },
          highlights: [
            {
              text: 'Calibration remains under review.',
              evidenceIds: [texts[0].id],
            },
          ],
          topics: [
            {
              title: 'Reconstruction',
              kind: 'project',
              summary: 'Researchers compared current reconstruction results.',
              evidenceIds: [texts[0].id],
            },
          ],
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/staging/${stage.uploadId}?revision=${stage.id}`);
  await expect(
    page.getByRole('heading', { name: 'Original Video', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Meeting summary', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#meeting-summary')).toContainText(
    'Reconstruction',
  );
  await expect(page.getByText('Ready to review', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('Local workspace', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.source-format')).toHaveCount(0);
  if (
    detail.memory.admittedRevisionIds?.includes(stage.id) ||
    detail.memory.revisionId === stage.id
  )
    await expect(
      page.getByRole('button', { name: 'Push To Memory', exact: true }),
    ).toHaveCount(0);
  const geometry = await page.evaluate(() => {
    const video = document
      .querySelector('#original-evidence')!
      .getBoundingClientRect();
    const summary = document
      .querySelector('#meeting-summary')!
      .getBoundingClientRect();
    const transcript = document
      .querySelector('#spoken-transcript')!
      .getBoundingClientRect();
    return {
      video: { top: video.top, bottom: video.bottom, left: video.left },
      summary: {
        top: summary.top,
        bottom: summary.bottom,
        left: summary.left,
        right: summary.right,
      },
      transcript: {
        top: transcript.top,
        bottom: transcript.bottom,
        left: transcript.left,
        right: transcript.right,
      },
    };
  });
  expect(Math.abs(geometry.video.top - geometry.transcript.top)).toBeLessThan(
    2,
  );
  expect(geometry.summary.top).toBeGreaterThan(
    Math.max(geometry.video.bottom, geometry.transcript.bottom),
  );
  expect(Math.abs(geometry.video.left - geometry.summary.left)).toBeLessThan(2);
  expect(
    Math.abs(geometry.summary.right - geometry.transcript.right),
  ).toBeLessThan(2);
  const summary = page.locator('#meeting-summary');
  const excerpt = summary.locator('.summary-excerpt');
  const collapsedHeight = await excerpt.evaluate(
    (node) => node.getBoundingClientRect().height,
  );
  const lineHeight = await excerpt.evaluate((node) =>
    parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(collapsedHeight).toBeLessThanOrEqual(15 * lineHeight + 1);
  await expect(summary.getByRole('tabpanel')).toBeVisible();
  const topics = await summary.locator('.topic-tabs').boundingBox();
  const topicDetails = await summary.getByRole('tabpanel').boundingBox();
  expect(topicDetails!.x).toBeGreaterThanOrEqual(topics!.x + topics!.width);
  await summary.getByRole('button', { name: 'Show more', exact: true }).click();
  expect(
    await excerpt.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThan(collapsedHeight);
  await summary.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(summary.getByRole('tabpanel')).toBeVisible();
  const player = page.locator('#original-evidence video');
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(1);
  await player.evaluate((video: HTMLVideoElement) => {
    video.muted = true;
    video.pause();
  });
  const timed = texts.find(
    (p) => p.locator.kind === 'media' && p.locator.startMs > 1000,
  )!;
  if (timed.locator.kind !== 'media') throw new Error('Missing timestamp');
  const ms = timed.locator.startMs;
  const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
  const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  await page
    .getByRole('button', { name: 'Show full transcript', exact: true })
    .click();
  const reader = page.getByRole('dialog', {
    name: 'Full transcript',
    exact: true,
  });
  await reader
    .getByRole('button', {
      name: `Play original from ${minutes}:${seconds}`,
      exact: true,
    })
    .first()
    .click();
  await expect(reader).not.toBeVisible();
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
  await expect
    .poll(() =>
      player.evaluate(
        (video: HTMLVideoElement, start) =>
          Math.abs(video.currentTime - start / 1000),
        ms,
      ),
    )
    .toBeLessThan(5);
  await player.evaluate((video: HTMLVideoElement) => video.pause());
  expect(
    await page
      .locator('.line-sidebar button')
      .first()
      .evaluate((button) => getComputedStyle(button).userSelect),
  ).toBe('none');
  const after = await (
    await page.request.get(`/api/uploads/${stage.uploadId}`)
  ).json();
  expect(after.revisions).toEqual(detail.revisions);
  expect(after.memory).toEqual(detail.memory);
  expect(unexpected).toEqual([]);
});

test('workspace header stays fixed while content scrolls below it across navigation', async ({
  page,
}) => {
  await protectWrites(page);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  const before = await nav.boundingBox();
  await page.locator('.workspace-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await nav.boundingBox()).toEqual(before);
  await nav.getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page).toHaveURL(/\/memory$/);
  expect(await nav.boundingBox()).toEqual(before);
  await nav.getByRole('link', { name: 'Ask', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Ask your research memory',
      exact: true,
    }),
  ).toBeVisible();
  expect(await nav.boundingBox()).toEqual(before);
  await nav.getByRole('link', { name: 'Memory', exact: true }).click();
  const geometry = await page.evaluate(() => {
    const header = document
      .querySelector('.workspace-header')!
      .getBoundingClientRect();
    const scroller = document
      .querySelector('.workspace-scroll')!
      .getBoundingClientRect();
    return {
      headerTop: header.top,
      headerBottom: header.bottom,
      scrollTop: scroller.top,
      windowScroll: window.scrollY,
    };
  });
  expect(geometry.headerTop).toBe(0);
  expect(geometry.scrollTop).toBe(geometry.headerBottom);
  expect(geometry.windowScroll).toBe(0);
  await nav.getByRole('link', { name: 'Staging', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(await nav.boundingBox()).toEqual(before);
});

test('activity persists across navigation and cancels exact tasks with dismissible completion', async ({
  page,
}) => {
  const { stage } = await meeting(page);
  const unexpected = await protectWrites(page);
  const pushId = '22222222-2222-4222-8222-222222222222',
    runId = '33333333-3333-4333-8333-333333333333';
  let tasks: ActivityTask[] = [
    {
      id: pushId,
      kind: 'push',
      generation: 0,
      title: 'Reviewed recording',
      operation: 'Push to memory',
      state: 'processing',
      percent: 42,
      phase: 'Summarizing sources',
      href: `/pushes/${pushId}`,
    },
    {
      id: runId,
      kind: 'interpretation',
      generation: 0,
      uploadId: stage.uploadId,
      title: 'Research meeting.mp4',
      operation: 'Transcription',
      state: 'processing',
      percent: 34,
      phase: 'Transcribing window 2',
      href: `/staging/${stage.uploadId}`,
    },
  ];
  await page.route('**/api/activity', (route) =>
    route.fulfill({ json: tasks }),
  );
  const canceled: string[] = [];
  await page.route(`**/api/pushes/${pushId}/cancel`, async (route) => {
    expect(route.request().method()).toBe('POST');
    canceled.push(pushId);
    tasks = tasks.map((task) =>
      task.id === pushId ? { ...task, state: 'canceled', generation: 1 } : task,
    );
    await route.fulfill({ json: { id: pushId, state: 'canceled' } });
  });
  await page.route(`**/api/uploads/${stage.uploadId}/cancel`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ runId });
    canceled.push(runId);
    tasks = tasks.map((task) =>
      task.id === runId ? { ...task, state: 'canceled' } : task,
    );
    await route.fulfill({ json: { run: { id: runId, state: 'canceled' } } });
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Processing status, 2 active tasks$/ })
    .click();
  let popup = page.getByRole('dialog', {
    name: 'Processing status',
    exact: true,
  });
  await expect(
    popup.getByRole('progressbar', {
      name: 'Push to memory progress for Reviewed recording',
    }),
  ).toHaveAttribute('aria-valuenow', '42');
  await page
    .locator('nav[aria-label="Workspace"]')
    .getByRole('link', { name: 'Memory', exact: true })
    .click();
  await expect(
    page
      .locator('nav[aria-label="Workspace"]')
      .getByRole('link', { name: 'Memory', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('button', { name: /^Processing status, 2 active tasks$/ })
    .click();
  popup = page.getByRole('dialog', { name: 'Processing status', exact: true });
  await expect(popup).toContainText('Research meeting.mp4');
  await popup
    .getByRole('button', {
      name: 'Cancel push to memory for Reviewed recording',
      exact: true,
    })
    .click();
  await popup
    .getByRole('button', {
      name: 'Cancel transcription for Research meeting.mp4',
      exact: true,
    })
    .click();
  await expect(popup.getByText('Canceled', { exact: true })).toHaveCount(2);
  await popup
    .getByRole('button', {
      name: 'Dismiss push to memory for Reviewed recording',
      exact: true,
    })
    .click();
  await expect(
    popup.getByText('Reviewed recording', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('button', { name: 'Processing status', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Processing status', exact: true }),
  ).toContainText('Research meeting.mp4');
  await expect(
    page
      .getByRole('dialog', { name: 'Processing status', exact: true })
      .getByText('Reviewed recording', { exact: true }),
  ).toHaveCount(0);
  expect(canceled).toEqual([pushId, runId]);
  expect(unexpected).toEqual([]);
});

test('an in-flight upload remains visible after leaving Staging and can be canceled there', async ({
  page,
}) => {
  const before = await (await page.request.get('/api/uploads')).json();
  const sources = (files: typeof before) =>
    files.map(({ run, ...file }: any) => file);
  const unexpected = await protectWrites(page);
  await page.route('**/api/activity', (route) => route.fulfill({ json: [] }));
  let sessionId = '',
    canceled = false,
    requestAborted = false;
  const transfer = latch();
  await page.route('**/api/upload-sessions', async (route) => {
    const input = route.request().postDataJSON();
    sessionId = input.id;
    expect(input.filenames).toEqual(['Upload test.mp4']);
    await route.fulfill({ json: { ...input, state: 'uploading' } });
  });
  await page.route('**/api/uploads?session=*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('session')).toBe(
      sessionId,
    );
    await transfer.promise;
    try {
      await route.fulfill({
        status: 409,
        json: { error: 'Test transfer was canceled.' },
      });
    } catch {}
  });
  await page.route('**/api/upload-sessions/*/cancel', async (route) => {
    expect(route.request().url()).toContain(sessionId);
    canceled = true;
    await route.fulfill({
      json: { id: sessionId, state: 'canceled', accepted: [] },
    });
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes(`/api/uploads?session=${sessionId}`))
      requestAborted = true;
  });
  try {
    await page.goto('/');
    await page.locator('#source-files').setInputFiles({
      name: 'Upload test.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.alloc(3 * 1024 * 1024),
    });
    await page
      .getByRole('button', { name: 'Upload to staging', exact: true })
      .click();
    await expect.poll(() => Boolean(sessionId)).toBe(true);
    await page
      .locator('nav[aria-label="Workspace"]')
      .getByRole('link', { name: 'Memory', exact: true })
      .click();
    await page
      .getByRole('button', { name: /^Processing status, 1 active task$/ })
      .click();
    const popup = page.getByRole('dialog', {
      name: 'Processing status',
      exact: true,
    });
    await expect(popup).toContainText('Upload test.mp4');
    await expect(popup.getByRole('progressbar')).toBeVisible();
    await popup
      .getByRole('button', {
        name: 'Cancel upload for Upload test.mp4',
        exact: true,
      })
      .click();
    await expect.poll(() => canceled).toBe(true);
    transfer.release();
    await expect.poll(() => requestAborted).toBe(true);
    await expect(popup.getByText('Canceled', { exact: true })).toBeVisible();
    expect(unexpected).toEqual([]);
    expect(
      sources(await (await page.request.get('/api/uploads')).json()),
    ).toEqual(sources(before));
  } finally {
    transfer.release();
  }
});
