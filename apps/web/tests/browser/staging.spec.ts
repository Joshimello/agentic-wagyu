import { test, expect } from '@playwright/test';
import corpus from '../../../../evals/meetings.json';
for (const recording of corpus.recordings) {
  test(`inspect ${recording.filename}, seek linked evidence and export without mutating the meeting`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Your evidence, ready for review.' }),
    ).toBeVisible();
    const uploads = await (await page.request.get('/api/uploads')).json();
    const video = uploads.find(
      (u: any) =>
        u.filename === recording.filename &&
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
    const stage = before.revisions.find(
      (r: any) => r.id === before.upload.currentRevisionId,
    ).manifest;
    if (stage.context) {
      await expect(
        page.getByRole('heading', {
          name: 'Transcript questions and frame searches',
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          `Read ${stage.context.readSegments}/${stage.context.totalSegments} speech segments.`,
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Revisit visual context' }),
      ).toBeVisible();
    }
    await expect(page.locator('video')).toBeVisible();
    await expect
      .poll(() =>
        page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    if (stage.context) {
      const index = stage.context.questions.findIndex(
        (q: any) => q.searches.length,
      );
      if (index >= 0) {
        const review = page
          .locator('.context-review')
          .first()
          .locator('details')
          .first();
        await review.locator('summary').first().click();
        const question = review.locator('.context-question').nth(index);
        await question.locator('summary').click();
        await expect(question.locator('.search-frame').first()).toBeVisible();
        await question.locator('.timestamp').first().click();
        const expected =
          stage.context.questions[index].searches[0].timesMs[0] / 1000;
        await expect
          .poll(() =>
            page
              .locator('video')
              .evaluate((v: HTMLVideoElement) => v.currentTime),
          )
          .toBeCloseTo(expected, 1);
        await review.locator('summary').first().click();
      }
    }
    if (stage.speakerSuggestions?.length) {
      const names = page.locator('.context-review').last();
      await names.locator('summary').click();
      await expect(names.locator('strong').first()).toContainText('→ possibly');
      const first = stage.speakerSuggestions[0];
      await expect(
        page
          .locator('.transcript .turn-head strong')
          .filter({ hasText: first.speaker })
          .first(),
      ).toHaveText(first.speaker);
      await names.locator('summary').click();
    }
    await page.locator('.transcript .timestamp').nth(1).click();
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
    expect(after.upload.currentRevisionId).toBe(
      before.upload.currentRevisionId,
    );
    expect(after.revisions.length).toBe(before.revisions.length);
  });
}
