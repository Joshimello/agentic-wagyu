import { test, expect } from '@playwright/test';
test('upload and inspect staging while memory stays empty', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your evidence, ready for review.' }),
  ).toBeVisible();
  const label = `Browser notes ${Date.now()}`;
  await page
    .getByLabel('Source file')
    .setInputFiles({
      name: 'browser-notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Launch on Friday. Browser regression evidence.'),
    });
  await page.getByLabel('Label (optional)').fill(label);
  await page.getByRole('button', { name: 'Upload to staging' }).click();
  await page.getByRole('link').filter({ hasText: label }).click();
  await expect(
    page.getByText('Launch on Friday. Browser regression evidence.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Not pushed to memory/)).toBeVisible();
  const source = page.getByRole('link', { name: 'Open original source' });
  const r = await page.request.get((await source.getAttribute('href'))!);
  expect(await r.text()).toContain('Launch on Friday.');
});

test('inspect video, seek linked evidence, correct text and export a pinned revision', async ({
  page,
}) => {
  const response = await page.request.get('/api/uploads');
  const uploads = await response.json();
  const video = uploads.find(
    (u: any) =>
      u.filename === 'meeting.mp4' &&
      ['ready', 'ready_with_warnings'].includes(u.run.state),
  );
  expect(video).toBeTruthy();
  await page.goto(`/staging/${video.id}`);
  await expect(
    page.getByRole('heading', { name: 'Spoken transcript' }),
  ).toBeVisible();
  await expect(
    page.getByText('ASR returned one anonymous speaker.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('video')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.locator('.timestamp').nth(1).click();
  await expect
    .poll(() =>
      page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('.frame img').first()).toBeVisible();
  await page.getByRole('button', { name: 'Correct text / labels' }).click();
  await page
    .getByLabel('Transcript text', { exact: true })
    .first()
    .fill('Browser reviewed introduction.');
  await page
    .getByRole('button', { name: 'Save correction', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Memory is unchanged');
  await expect(
    page.getByText('Browser reviewed introduction.', { exact: true }),
  ).toBeVisible();
  const href = await page
    .getByRole('link', { name: 'Export Markdown', exact: true })
    .getAttribute('href');
  const exported = await page.request.get(href!);
  expect(await exported.text()).toContain('Browser reviewed introduction.');
  const options = await page
    .getByLabel('Staging revision')
    .locator('option')
    .all();
  expect(options.length).toBeGreaterThan(2);
  await page
    .getByLabel('Staging revision')
    .selectOption(
      (await options[options.length - 1].getAttribute('value')) ?? 'current',
    );
  await expect(
    page.getByRole('button', { name: 'Correct text / labels' }),
  ).toHaveCount(0);
  await expect(page.getByText(/Not pushed to memory/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '/data/fixtures/staging-preview.png',
    fullPage: true,
  });
});
