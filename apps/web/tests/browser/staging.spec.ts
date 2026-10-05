import { test, expect } from '@playwright/test';
test('inspect real video, seek linked evidence and export without mutating the meeting', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your evidence, ready for review.' }),
  ).toBeVisible();
  const uploads = await (await page.request.get('/api/uploads')).json();
  const video = uploads.find(
    (u: any) =>
      /^2026-09-\d{2}\.mp4$/.test(u.filename) &&
      ['ready', 'ready_with_warnings'].includes(u.run.state),
  );
  expect(video).toBeTruthy();
  const before = await (
    await page.request.get(`/api/uploads/${video.id}`)
  ).json();
  await page.goto(`/staging/${video.id}`);
  await expect(
    page.getByRole('heading', { name: 'Spoken transcript' }),
  ).toBeVisible();
  await expect(page.getByText(/Not pushed to memory/)).toBeVisible();
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
  await page.locator('.frame img').first().click();
  const href = await page
    .getByRole('link', { name: 'Export Markdown', exact: true })
    .getAttribute('href');
  const exported = await page.request.get(href!);
  expect(exported.ok()).toBe(true);
  expect(await exported.text()).toContain('## Visual context');
  const original = await page
    .getByRole('link', { name: 'Open original source' })
    .getAttribute('href');
  const raw = await page.request.get(original!, {
    headers: { Range: 'bytes=0-31' },
  });
  expect(raw.status()).toBe(206);
  const after = await (
    await page.request.get(`/api/uploads/${video.id}`)
  ).json();
  expect(after.upload.currentRevisionId).toBe(before.upload.currentRevisionId);
  expect(after.revisions.length).toBe(before.revisions.length);
});
