import { expect } from '@playwright/test';
import { test } from './fixtures';

test('summary memory opens shared segments from project and source views with exact evidence', async ({
  page,
}) => {
  const response = await page.request.get('/api/memory/organized');
  expect(response.ok()).toBe(true);
  const memory = await response.json();
  test.skip(!memory.sources.length, 'No organized real sources available yet');
  await page.goto(`/memory?knownVersion=${memory.version}`);
  await expect(
    page.getByRole('heading', { name: 'Research memory', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sources and segments', exact: true }),
  ).toBeVisible();
  const project = memory.projects[0];
  expect(project).toBeTruthy();
  await page
    .getByRole('link', { name: project.current.title, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: project.current.title, exact: true }),
  ).toBeVisible();
  const projectDetail = await (
    await page.request.get(
      `/api/memory/nodes/${project.id}?knownVersion=${memory.version}`,
    )
  ).json();
  const topic = projectDetail.children[0];
  await page
    .getByRole('link', { name: topic.title, exact: true })
    .first()
    .click();
  const topicDetail = await (
    await page.request.get(
      `/api/memory/nodes/${topic.id}?versionId=${topic.versionId}&knownVersion=${memory.version}`,
    )
  ).json();
  const segment = topicDetail.children[0];
  await page
    .getByRole('link', { name: segment.title, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Original evidence', exact: true }),
  ).toBeVisible();
  const leaf = await (
    await page.request.get(
      `/api/memory/nodes/${segment.id}?versionId=${segment.versionId}&knownVersion=${memory.version}`,
    )
  ).json();
  expect(leaf.parents.map((p: any) => p.kind)).toContain('source');
  expect(leaf.parents.map((p: any) => p.kind)).toContain('topic');
  expect(leaf.source.revisionId).toBe(
    memory.segments.find((s: any) => s.id === segment.id).revisionId,
  );
  if (leaf.source.content.texts.length)
    await expect(page.locator('article.turn').first()).toContainText(
      leaf.source.content.texts[0].text,
    );
  if (leaf.source.content.images.length)
    await expect(page.locator('figure img').first()).toHaveAttribute(
      'src',
      `/api/assets/${leaf.source.content.images[0].assetId}`,
    );
  const source = leaf.parents.find((p: any) => p.kind === 'source');
  await page
    .getByRole('link', { name: source.title, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('link', { name: segment.title, exact: true }).first(),
  ).toBeVisible();
  const forbidden = await page.request.get(
    `/api/memory/nodes/${segment.id}?knownVersion=0`,
  );
  expect(forbidden.status()).toBe(400);
});
test('search shows original-text matches and pins result links to a recorded version', async ({
  page,
}) => {
  const memory = await (await page.request.get('/api/memory/organized')).json();
  test.skip(!memory.segments.length, 'No organized real sources available yet');
  let term = '',
    selected: any;
  for (const s of memory.segments) {
    const leaf = await (
      await page.request.get(`/api/memory/nodes/${s.id}`)
    ).json();
    const text = leaf.source.content.texts.find(
      (t: any) => t.text.trim().length > 12,
    );
    if (text) {
      term = text.text.trim().slice(0, 18);
      selected = leaf;
      break;
    }
  }
  expect(term).toBeTruthy();
  const search = await (
    await page.request.get(
      `/api/memory/organized/search?q=${encodeURIComponent(term)}&knownVersion=${memory.version}`,
    )
  ).json();
  expect(
    search.hits.some(
      (h: any) => h.nodeId === selected.node.id && h.sourceMatched,
    ),
  ).toBe(true);
  await page.goto(
    `/memory?q=${encodeURIComponent(term)}&knownVersion=${memory.version}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Search results', exact: true }),
  ).toBeVisible();
  const hit = page
    .getByRole('link', { name: selected.node.current.title, exact: true })
    .first();
  await expect(hit).toHaveAttribute(
    'href',
    new RegExp(`knownVersion=${memory.version}`),
  );
  await page.goto('/memory?knownVersion=0');
  await expect(
    page.getByText('No organized projects in this snapshot.', { exact: false }),
  ).toBeVisible();
});
