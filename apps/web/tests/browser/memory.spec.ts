import { test, expect } from '@playwright/test';
test('memory snapshots show a stable graph, recorded history and admitted citations', async ({
  page,
}) => {
  const initial = await (await page.request.get('/api/memory')).json();
  await page.goto(`/memory?knownVersion=${initial.version}`);
  await expect(
    page.getByRole('heading', { name: 'Research memory', exact: true }),
  ).toBeVisible();
  if (!initial.statements.length) {
    await expect(
      page.getByRole('heading', {
        name: 'Memory starts with an explicit push',
      }),
    ).toBeVisible();
    return;
  }
  await expect(
    page.getByRole('img', {
      name: 'Project memory graph with assertions and source relationships',
    }),
  ).toBeVisible();
  for (const project of initial.projects) {
    const newest = initial.statements
      .filter(
        (s: any) =>
          s.projectId === project.id &&
          ['active', 'conflicted'].includes(s.status),
      )
      .sort(
        (a: any, b: any) =>
          b.current.commitVersion - a.current.commitVersion ||
          a.id.localeCompare(b.id),
      )[0];
    if (newest && initial.projects.length <= 80)
      await expect(
        page
          .getByRole('button', {
            name: `Inspect ${newest.current.text}`,
            exact: true,
          })
          .first(),
      ).toBeAttached();
  }
  const item = initial.statements.find((s: any) =>
    ['active', 'conflicted'].includes(s.status),
  );
  expect(item).toBeTruthy();
  await page
    .locator('button.assertion')
    .filter({ hasText: item.current.text })
    .first()
    .click();
  const detail = page.locator('#statement-detail');
  await expect(detail).toContainText(item.current.text);
  await expect(
    detail.getByRole('heading', { name: 'Recorded history' }),
  ).toBeVisible();
  const source = item.evidence[0];
  expect(source).toBeTruthy();
  await detail
    .getByRole('link', {
      name: `Open source ${source.primitiveId.slice(0, 8)}`,
    })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Source evidence', exact: true }),
  ).toBeVisible();
  const response = await page.request.get(
    `/api/evidence/${source.revisionId}/${source.primitiveId}?knownVersion=${initial.version}`,
  );
  expect(response.ok()).toBe(true);
  const evidence = await response.json();
  if (evidence.primitive.kind === 'text')
    await expect(page.locator('blockquote')).toHaveText(
      evidence.primitive.text,
    );
  else
    await expect(
      page.getByAltText('Cited original visual evidence'),
    ).toHaveAttribute('src', `/api/assets/${evidence.primitive.assetId}`);
  const forbidden = await page.request.get(
    `/api/evidence/${source.revisionId}/${source.primitiveId}?knownVersion=0`,
  );
  expect(forbidden.status()).toBe(404);
});
test('project views scope graph assertions and empty latest filters preserve the current version', async ({
  page,
}) => {
  const current = await (await page.request.get('/api/memory')).json();
  if (!current.projects.length) return;
  const project = current.projects[0];
  const scoped = await (
    await page.request.get(
      `/api/memory?knownVersion=${current.version}&projectId=${project.id}`,
    )
  ).json();
  expect(scoped.projects.map((p: any) => p.id)).toEqual([project.id]);
  expect(scoped.statements.every((s: any) => s.projectId === project.id)).toBe(
    true,
  );
  await page.goto(
    `/memory?knownVersion=${current.version}&projectId=${project.id}`,
  );
  await expect(
    page.getByRole('heading', { name: project.name, exact: true }),
  ).toBeVisible();
  const latest = await (
    await page.request.get(
      '/api/memory?knownVersion=&projectId=&effectiveDate=',
    )
  ).json();
  expect(latest.version).toBeGreaterThanOrEqual(current.version);
  await page.goto('/memory?knownVersion=0');
  await expect(
    page.getByRole('heading', { name: 'Memory starts with an explicit push' }),
  ).toBeVisible();
});
