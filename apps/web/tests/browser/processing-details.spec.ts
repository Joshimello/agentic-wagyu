import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import type { ProcessingDetails } from '../../src/lib/server/services/processing';

async function sourceWithHistory(page: Page) {
  const responseList = await page.request.get('/api/uploads');
  expect(responseList.ok()).toBe(true);
  const uploads = await responseList.json();
  const source =
    uploads.find(
      (upload: { run?: { state: string } }) => upload.run?.state === 'failed',
    ) ?? uploads[0];
  test.skip(!source, 'No local source is available for processing review.');
  if (!source) throw new Error('No local source');
  const response = await page.request.get(
    `/api/uploads/${source.id}/processing`,
  );
  expect(response.ok()).toBe(true);
  return { source, details: (await response.json()) as ProcessingDetails };
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name}: processing details show attempts and a readable downloadable failure log`, async ({
    page,
  }) => {
    const { source, details } = await sourceWithHistory(page);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const failed = details.runs.find((run) => run.state === 'failed');
    const historical = failed
      ? ((await (
          await page.request.get(
            `/api/uploads/${source.id}/processing?runId=${failed.id}`,
          )
        ).json()) as ProcessingDetails)
      : null;
    let reads = 0;
    await page.route(
      `**/api/uploads/${source.id}/processing*`,
      async (route) => {
        reads++;
        const requestedRun = new URL(route.request().url()).searchParams.get(
          'runId',
        );
        await route.fulfill({
          json:
            historical && requestedRun === historical.selectedRunId
              ? historical
              : details,
        });
      },
    );
    await page.goto(`/staging/${source.id}`);
    await expect(
      page.getByRole('button', { name: 'More', exact: true }),
    ).toBeEnabled();
    expect(reads).toBe(0);
    await page
      .getByRole('button', { name: 'Processing details', exact: true })
      .click();
    const log = page.getByRole('textbox', {
      name: 'Processing log',
      exact: true,
    });
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute('readonly', '');
    expect(await log.inputValue()).toContain(details.selectedRunId);
    if (historical) {
      await page.getByRole('combobox', { name: 'Processing run', exact: true })
        .selectOption(historical.selectedRunId);
      await expect(log).toHaveValue(/State: failed/);
    }
    const displayed = historical ?? details;
    if (displayed.failure)
      expect(await log.inputValue()).toContain(displayed.failure.message);
    const downloading = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download log', exact: true })
      .click();
    const downloaded = await downloading;
    expect(downloaded.suggestedFilename()).toBe(
      `processing-${displayed.selectedRunId}.txt`,
    );
    expect(await Bun.file((await downloaded.path())!).text()).toContain(
      displayed.selectedRunId,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.locator('.processing-details').screenshot({
      path: `${process.env.BROWSER_RESULTS ?? '/data/browser-results'}/processing-details-${viewport.name}.png`,
    });
    await page
      .getByRole('button', { name: 'Processing details', exact: true })
      .click();
    await expect(log).not.toBeVisible();
  });
}

test('a recent failed attempt remains observable and the details follow its automatic retry', async ({
  page,
}) => {
  const { source, details } = await sourceWithHistory(page);
  const current = details.runs[0];
  const fixture = structuredClone(details);
  const now = Date.now();
  fixture.runs[0] = {
    ...current,
    state: 'failed',
    updatedAt: new Date(now - 10 * 60000).toISOString(),
    retryPending: true,
  };
  fixture.failure = {
    type: 'TimeoutError',
    code: 'media_timeout',
    message: 'Earlier request timed out',
    stack: 'TimeoutError: Earlier request timed out',
    retryable: true,
  };
  fixture.failureSource = 'processing_log';
  let reads = 0;
  await page.route(`**/api/uploads/${source.id}/processing*`, async (route) => {
    reads++;
    if (reads > 1) {
      fixture.runs[0] = {
        ...fixture.runs[0],
        state: 'processing',
        retryPending: false,
        attempts: current.attempts + 1,
        progress: 'Transcribing audio window 1/2',
        updatedAt: new Date().toISOString(),
      };
      fixture.live = {
        jobId: current.id,
        status: 'running',
        stage: 'transcribing',
        coveredMs: 120000,
        startMs: 0,
        durationMs: 1800000,
        generatedTokens: 512,
        updatedAt: new Date().toISOString(),
      };
    }
    await route.fulfill({ json: fixture });
  });
  await page.clock.install({ time: new Date(now) });
  await page.goto(`/staging/${source.id}`);
  await expect(
    page.getByRole('button', { name: 'More', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Processing details', exact: true })
    .click();
  const log = page.getByRole('textbox', {
    name: 'Processing log',
    exact: true,
  });
  await expect(log).toHaveValue(/State: failed/);
  await page.clock.runFor(5500);
  await expect(log).toHaveValue(/State: processing/);
  await expect(page.locator('.processing-facts')).toContainText(
    '512 generated tokens',
  );
  expect(reads).toBeGreaterThan(1);
});

test('processing diagnostics reject a run from another upload and invalid identifiers', async ({
  page,
}) => {
  const { source } = await sourceWithHistory(page);
  const other = crypto.randomUUID();
  expect(
    (
      await page.request.get(
        `/api/uploads/${source.id}/processing?runId=${other}`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        `/api/uploads/${source.id}/processing?runId=../assets`,
      )
    ).status(),
  ).toBe(400);
});
