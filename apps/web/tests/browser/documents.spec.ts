import { test, expect } from '@playwright/test';
import corpus from '../../../../evals/documents.json';
for (const document of corpus.documents) {
  test(`inspect ${document.filename} source mapping and export without changing evidence`, async ({
    page,
  }) => {
    const uploads = await (await page.request.get('/api/uploads')).json();
    const file = uploads.find((u: any) => u.filename === document.filename);
    expect(file).toBeTruthy();
    const before = await (
      await page.request.get(`/api/uploads/${file.id}`)
    ).json();
    const stage = before.revisions.find(
      (r: any) => r.id === before.upload.currentRevisionId,
    ).manifest;
    await page.goto(`/staging/${file.id}`);
    await expect(
      page.getByRole('heading', { name: 'Document evidence' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Document summary', exact: true }),
    ).toBeVisible();
    if (stage.document.review?.summary)
      await expect(page.locator('.summary-text')).toHaveText(
        stage.document.review.summary.text,
      );
    else
      await expect(
        page.getByText('No generated summary is available for this revision.', {
          exact: false,
        }),
      ).toBeVisible();
    const image = page.locator('img[alt$="source render"]');
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const select = page.locator('.document-viewer select');
    expect(await select.locator('option').count()).toBe(
      stage.document.units.length,
    );
    if (stage.document.review?.unitLabels.length)
      expect(
        await select
          .locator('option')
          .nth(stage.document.review.unitLabels[0].unitNumber - 1)
          .textContent(),
      ).toContain(stage.document.review.unitLabels[0].label);
    if (stage.document.media?.length) {
      const embedded = stage.document.media.find(
        (m: any) =>
          m.unitNumbers.length &&
          !stage.document.review?.skippedMedia?.some(
            (s: any) => s.mediaId === m.id,
          ),
      );
      if (embedded) {
        await select.selectOption({
          value: String(embedded.unitNumbers[0] - 1),
        });
        const label = stage.document.review?.mediaLabels.find(
          (l: any) => l.mediaId === embedded.id,
        )?.label;
        await expect(page.locator(`#media-${embedded.id}`)).toContainText(
          label ?? `Embedded ${embedded.kind}`,
        );
        await select.selectOption({ value: '0' });
      }
    }
    const skipped = stage.document.review?.skippedMedia?.find(
      (s: any) =>
        stage.document.media.find((m: any) => m.id === s.mediaId)?.unitNumbers
          .length,
    );
    if (skipped) {
      const item = stage.document.media.find(
        (m: any) => m.id === skipped.mediaId,
      );
      await select.selectOption({ value: String(item.unitNumbers[0] - 1) });
      const boilerplate = page.locator('.boilerplate-media');
      await expect(boilerplate).not.toHaveAttribute('open');
      await boilerplate.locator('summary').click();
      await expect(page.locator(`#media-${item.id}`)).toContainText(
        skipped.reason.replaceAll('_', ' '),
      );
      await expect(page.locator(`#media-${item.id} a`)).toHaveAttribute(
        'href',
        `/api/assets/${item.assetId}`,
      );
      await select.selectOption({ value: '0' });
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(select).toHaveValue('1');
    await expect(image).toHaveAttribute('alt', /2 source render$/);
    await select.selectOption({
      value: String(stage.document.units.length - 1),
    });
    await expect(image).toHaveAttribute(
      'alt',
      new RegExp(`${stage.document.units.length} source render$`),
    );
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const href = await page
      .getByRole('link', { name: 'Export Markdown', exact: true })
      .getAttribute('href');
    const exported = await page.request.get(href!);
    expect(exported.ok()).toBe(true);
    expect(await exported.text()).toContain('## Document extraction');
    if (document.filename === '260629_VLM.pptx')
      await page.screenshot({
        path: '/data/evaluations/document-viewer.png',
        fullPage: true,
      });
    const after = await (
      await page.request.get(`/api/uploads/${file.id}`)
    ).json();
    expect(after.upload.currentRevisionId).toBe(
      before.upload.currentRevisionId,
    );
    expect(after.revisions.length).toBe(before.revisions.length);
  });
}
test('select a recording and deck, persist exact revisions and review partial extraction', async ({
  page,
}) => {
  const initial = await (await page.request.get('/api/selections')).json();
  const uploads = await (await page.request.get('/api/uploads')).json();
  const files = [
    uploads.find((u: any) => /\.mp4$/i.test(u.filename)),
    uploads.find((u: any) => u.filename === '260629_VLM.pptx'),
  ];
  try {
    await page.goto('/');
    for (const file of files) {
      expect(file).toBeTruthy();
      await page
        .getByRole('checkbox', { name: `Select ${file.filename}`, exact: true })
        .check();
    }
    await expect(
      page.getByRole('heading', { name: /Selected revisions/ }),
    ).toBeVisible();
    await page.reload();
    for (const file of files)
      await expect(
        page.getByRole('checkbox', {
          name: `Select ${file.filename}`,
          exact: true,
        }),
      ).toBeChecked();
    const selected = await (await page.request.get('/api/selections')).json();
    for (const file of files)
      expect(selected.find((s: any) => s.uploadId === file.id).revisionId).toBe(
        file.currentRevisionId,
      );
    await expect(
      page.getByRole('button', { name: 'Push selected files to memory' }),
    ).toBeDisabled();
    await page.screenshot({
      path: '/data/evaluations/document-selection.png',
      fullPage: true,
    });
  } finally {
    for (const file of files) {
      if (!file) continue;
      const old = initial.find((s: any) => s.uploadId === file.id);
      if (old)
        await page.request.post('/api/selections', {
          data: {
            uploadId: old.uploadId,
            revisionId: old.revisionId,
            acceptPartial: old.acceptPartial,
          },
        });
      else
        await page.request.delete('/api/selections', {
          data: { uploadId: file.id },
        });
    }
  }
});
