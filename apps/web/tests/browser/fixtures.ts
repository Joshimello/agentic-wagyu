import { test as base } from '@playwright/test';

// Browser checks read real evidence but never start model work implicitly.
export const test = base.extend<{ summaryPreview: void }>({
  summaryPreview: [
    async ({ page }, use) => {
      await page.route('**/api/uploads/*/summary?*', async (route) => {
        const response = await route.fetch();
        const revisionId = new URL(route.request().url()).searchParams.get(
          'revision',
        )!;
        const cached = response.ok() ? await response.json() : null;
        if (cached?.state === 'ready') await route.fulfill({ response });
        else
          await route.fulfill({
            json: {
              id: null,
              revisionId,
              state: 'canceled',
              generation: 0,
              progressPercent: 0,
              summary: null,
              error: null,
            },
          });
      });
      await use();
    },
    { auto: true },
  ],
});
