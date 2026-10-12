import { test } from './fixtures';
import { expect } from '@playwright/test';
type Fixture = {
  projectId: string;
  earlierRevisionId: string;
  laterRevisionId: string;
  uploadId: string;
  questionId: string;
  modes: { width: number; approve: string; edit: string; reject: string }[];
};
test.skip(
  process.env.CHANGES_BROWSER !== '1',
  'Requires the dedicated comparison-review fixture workspace.',
);
test.describe.configure({ mode: 'serial' });
let fixture: Fixture;
test.beforeAll(async () => {
  fixture = await Bun.file('/data/changes-browser.json').json();
});
for (const width of [1280, 390]) {
  test(`comparison selection, durable cancel and retry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/changes');
    await expect(
      page.getByRole('heading', { name: 'What changed?' }),
    ).toBeVisible();
    await page.getByLabel('Accepted project').selectOption(fixture.projectId);
    await page
      .getByLabel('Earlier meeting')
      .selectOption(fixture.earlierRevisionId);
    await page
      .getByLabel('Later meeting')
      .selectOption(fixture.laterRevisionId);
    await page.screenshot({
      path: `/results/changes-selection-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Compare meetings', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Review meeting changes' }),
    ).toBeVisible();
    await expect(page.getByText('Unknown date', { exact: true })).toHaveCount(
      2,
    );
    await page
      .getByRole('button', { name: 'Cancel comparison', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Retry with the same evidence and baseline',
      }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: 'Retry with the same evidence and baseline',
      })
      .click();
    await expect(
      page.getByRole('button', { name: 'Cancel comparison', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  test(`approve, edit with verification guards, reject and review evidence at ${width}px`, async ({
    page,
    request,
  }) => {
    const mode = fixture.modes.find((m) => m.width === width)!;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/changes/${mode.approve}`);
    await expect(
      page.getByRole('heading', { name: 'Earlier statement' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Later statement' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel('Review reason')
      .fill('Both source reports were checked.');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Open immutable review event' }),
    ).toBeVisible();
    const approved = await (
      await request.get(`/api/comparisons/${mode.approve}`)
    ).json();
    expect(approved.proposals[0].review.input.action).toBe('approve');
    await page.goto(`/changes/${mode.edit}`);
    await page.getByRole('button', { name: 'Edit proposal' }).click();
    await page.getByLabel('Owner', { exact: true }).fill('Local reviewer');
    await page
      .getByLabel('Commitment status')
      .selectOption('completion_verified');
    await page
      .getByLabel('Review reason')
      .fill('Completion criteria were reviewed.');
    await page.getByRole('button', { name: 'Edit and approve' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Verification requires',
    );
    await page
      .getByLabel('Completion criteria', { exact: true })
      .fill('All calibration cases pass.');
    await page
      .getByRole('checkbox', { name: 'I explicitly verify completion' })
      .check();
    await page.getByRole('button', { name: 'Edit and approve' }).click();
    await page
      .getByRole('link', { name: 'Open immutable review event' })
      .click();
    await expect(page.getByText('Reviewer-added fields:')).toContainText(
      'owner',
    );
    await expect(page.getByText('Status: completion verified')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'earlier-unknown.mp4' }),
    ).toBeVisible();
    await page.screenshot({
      path: `/results/changes-review-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole('link', { name: 'earlier-unknown.mp4', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Source evidence' }),
    ).toBeVisible();
    await expect(page.locator('blockquote')).toHaveText(
      'We plan to run the calibration test.',
    );
    await page.goto(`/changes/${mode.reject}`);
    await page
      .getByLabel('Review reason')
      .fill('Does not establish a reliable commitment.');
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByText(/Rejected - review/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  test(`Ask reviewed-state references and speaker-only revisit pins revision at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/ask/${fixture.questionId}`);
    await expect(
      page.getByText('Reviewed state', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Reviewer additions: owner', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'Approved review 1', exact: true })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Review event 1' }),
    ).toBeVisible();
    await page.goto(`/staging/${fixture.uploadId}`);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Revisit speaker names' }),
    ).toBeVisible();
    // Inspect the request contract without starting a worker or changing source history.
    await page.route('**/api/uploads/*/retry', (route) =>
      route.fulfill({ status: 202, json: { runId: 'browser-contract-check' } }),
    );
    const sent = page.waitForRequest(
      (r) => r.url().endsWith('/retry') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Revisit speaker names' }).click();
    const input = (await sent).postDataJSON();
    expect(input.mode).toBe('speakers');
    expect(input.inputRevisionId).toBe(fixture.laterRevisionId);
    const detail = await (
      await request.get(`/api/uploads/${fixture.uploadId}`)
    ).json();
    expect(detail.upload.currentRevisionId).toBe(fixture.laterRevisionId);
    await page.screenshot({
      path: `/results/changes-${width}.png`,
      fullPage: true,
    });
  });
}
