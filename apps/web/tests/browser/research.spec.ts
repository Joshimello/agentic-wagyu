import { test, expect } from '@playwright/test';
test('Ask submits an empty-snapshot question and preserves its cited-answer scope', async ({
  page,
}) => {
  await page.goto('/ask');
  await expect(
    page.getByRole('heading', { name: 'Ask your research memory' }),
  ).toBeVisible();
  await page
    .getByLabel('Question', { exact: true })
    .fill('At this empty snapshot, what results are known about MoGe?');
  await page.getByLabel('Memory snapshot').selectOption('0');
  await page
    .getByRole('button', { name: 'Ask Researcher', exact: true })
    .click();
  await page.waitForURL(/\/ask\/[a-f0-9-]+$/);
  await expect(
    page.getByText('insufficient evidence', { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(
    page.getByRole('link', { name: 'Memory snapshot 0', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Missing evidence and limitations' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('insufficient evidence', { exact: true }),
  ).toBeVisible();
});
test('saved real answers open exact pinned excerpts and original visual evidence', async ({
  page,
}) => {
  const list = await (await page.request.get('/api/research')).json();
  const complete = list.find(
    (r: any) => r.state === 'completed' && r.scope.version > 0,
  );
  test.skip(!complete, 'No completed real-corpus answer yet');
  const run = await (
    await page.request.get(`/api/research/${complete.id}`)
  ).json();
  test.skip(!run.answer?.citations.length, 'Answer has no citations');
  await page.goto(`/ask/${run.id}`);
  await expect(
    page.getByRole('heading', { name: run.input.question, exact: true }),
  ).toBeVisible();
  const text = run.answer.citations.find((c: any) => c.kind === 'text');
  if (text) {
    await page.locator(`a[href="${text.url}"]`).first().click();
    await expect(page.locator('blockquote')).toHaveText(text.quote);
    await expect(
      page.getByRole('link', { name: 'Inspect pinned source context' }),
    ).toHaveAttribute('href', new RegExp(`revision=${text.revisionId}`));
  }
  const visual = run.answer.citations.find((c: any) => c.kind === 'image');
  if (visual) {
    await page.goto(visual.url);
    await expect(
      page.getByAltText('Cited original visual evidence'),
    ).toBeVisible();
  }
  await page.goto(`/ask/${run.id}`);
  await page.screenshot({
    path: '/data/evaluations/researcher-answer.png',
    fullPage: true,
  });
});
