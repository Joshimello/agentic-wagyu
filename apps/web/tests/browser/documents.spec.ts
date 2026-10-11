import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import corpus from '../../../../evals/documents.json';
import type { Stage, Primitive } from '../../src/lib/server/contracts';

type Upload = {
  id: string;
  filename: string;
  currentRevisionId: string | null;
  run: { state: string } | null;
};

async function chooseUnit(page: Page, index: number) {
  const select = page.locator('.document-viewer').getByRole('combobox');
  await select.click();
  await page.getByRole('listbox').getByRole('option').nth(index).click();
  await expect(select).toHaveAttribute('aria-expanded', 'false');
}

for (const document of corpus.documents) {
  test(`inspect ${document.filename} source mapping and export without changing evidence`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    const uploads: Upload[] = await (
      await page.request.get('/api/uploads')
    ).json();
    const file = uploads.find(
      (upload) =>
        upload.filename === document.filename &&
        upload.currentRevisionId &&
        ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
    );
    test.skip(
      !file ||
        !file.currentRevisionId ||
        !['ready', 'ready_with_warnings'].includes(file.run?.state ?? ''),
      `${document.filename} is absent or has not finished processing on this PC.`,
    );
    const before = await (
      await page.request.get(`/api/uploads/${file!.id}`)
    ).json();
    const stage: Stage | undefined = before.revisions.find(
      (revision: any) => revision.id === before.upload.currentRevisionId,
    )?.manifest;
    expect(stage?.document).toBeTruthy();
    if (!stage?.document)
      throw new Error(
        'Ready document has no current document evidence revision',
      );
    const evidence = stage.document;
    await page.goto(`/staging/${file!.id}?revision=${stage.id}`);
    await expect(
      page.getByRole('heading', { name: 'Document evidence', exact: true }),
    ).toBeVisible();
    const summary = page.getByRole('button', {
      name: 'Document summary',
      exact: true,
    });
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await summary.click();
    if (evidence.review?.summary)
      await expect(page.locator('.summary-text')).toHaveText(
        evidence.review.summary.text,
      );
    else
      await expect(
        page.getByText('No generated summary for this revision.', {
          exact: false,
        }),
      ).toBeVisible();

    const image = page.locator('img[alt$="source render"]');
    const select = page.locator('.document-viewer').getByRole('combobox');
    await select.click();
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options).toHaveCount(evidence.units.length);
    if (evidence.review?.unitLabels.length) {
      const label = evidence.review.unitLabels[0];
      await expect(options.nth(label.unitNumber - 1)).toContainText(
        label.label,
      );
    }
    await page.keyboard.press('Escape');

    // Check each extracted unit and its exact source mapping, including PDF text.
    for (const [index, unit] of evidence.units.entries()) {
      await chooseUnit(page, index);
      const render = stage.primitives.find(
        (primitive) => primitive.id === unit.renderId,
      );
      expect(render?.kind).toBe('image');
      if (render?.kind !== 'image')
        throw new Error(`Missing source render for unit ${unit.number}`);
      await expect(image).toHaveAttribute(
        'src',
        `/api/assets/${render.assetId}`,
      );
      await expect(image).toHaveAttribute(
        'alt',
        new RegExp(`${unit.number} source render$`),
      );
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const sourceText = page.getByRole('button', {
        name: 'Extracted source text and notes',
        exact: true,
      });
      if ((await sourceText.getAttribute('aria-expanded')) === 'false')
        await sourceText.click();
      for (const ref of unit.textIds) {
        const text = stage.primitives.find(
          (primitive): primitive is Extract<Primitive, { kind: 'text' }> =>
            primitive.id === ref && primitive.kind === 'text',
        );
        expect(text).toBeTruthy();
        await expect(page.locator(`#text-${ref} > p`)).toHaveText(text!.text);
      }
    }

    const embedded = evidence.media?.find(
      (item) =>
        item.unitNumbers.length &&
        !evidence.review?.skippedMedia?.some(
          (skipped) => skipped.mediaId === item.id,
        ),
    );
    if (embedded) {
      await chooseUnit(page, embedded.unitNumbers[0] - 1);
      const label = evidence.review?.mediaLabels.find(
        (item) => item.mediaId === embedded.id,
      )?.label;
      await expect(page.locator(`#media-${embedded.id}`)).toContainText(
        label ?? `Embedded ${embedded.kind}`,
      );
      await expect(
        page.locator(`#media-${embedded.id} .media-actions a`),
      ).toHaveAttribute('href', `/api/assets/${embedded.assetId}`);
    }
    const skipped = evidence.review?.skippedMedia?.find(
      (entry) =>
        evidence.media?.find((item) => item.id === entry.mediaId)?.unitNumbers
          .length,
    );
    if (skipped) {
      const item = evidence.media!.find(
        (media) => media.id === skipped.mediaId,
      )!;
      await chooseUnit(page, item.unitNumbers[0] - 1);
      const decorations = page.getByRole('button', {
        name: /^Logos, stamps and decoration/,
      });
      await expect(decorations).toHaveAttribute('aria-expanded', 'false');
      await decorations.click();
      await expect(page.locator(`#media-${item.id}`)).toContainText(
        skipped.reason.replaceAll('_', ' '),
      );
      await expect(page.locator(`#media-${item.id} a`)).toHaveAttribute(
        'href',
        `/api/assets/${item.assetId}`,
      );
    }
    await chooseUnit(page, 0);
    if (evidence.units.length > 1) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(image).toHaveAttribute('alt', /2 source render$/);
    }
    await chooseUnit(page, evidence.units.length - 1);
    await expect(image).toHaveAttribute(
      'alt',
      new RegExp(`${evidence.units.at(-1)!.number} source render$`),
    );

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const href = await page
      .getByRole('link', { name: 'Markdown', exact: true })
      .getAttribute('href');
    expect(href).toContain(`revision=${stage.id}`);
    const exported = await page.request.get(href!);
    expect(exported.ok()).toBe(true);
    expect(await exported.text()).toContain('## Document extraction');
    await page.keyboard.press('Escape');
    const original = `/api/assets/${stage.rawAssetId}`;
    const raw = await page.request.get(original!, {
      headers: { Range: 'bytes=0-31' },
    });
    expect(raw.status()).toBe(206);
    expect((await raw.body()).byteLength).toBe(32);
    const after = await (
      await page.request.get(`/api/uploads/${file!.id}`)
    ).json();
    expect(after.upload.currentRevisionId).toBe(
      before.upload.currentRevisionId,
    );
    expect(after.revisions.length).toBe(before.revisions.length);
    expect(after.memory).toEqual(before.memory);
  });
}

test('select a recording and deck, persist exact revisions and review partial extraction', async ({
  page,
}) => {
  const initial = await (await page.request.get('/api/selections')).json();
  const uploads: Upload[] = await (
    await page.request.get('/api/uploads')
  ).json();
  const files = [
    uploads.find(
      (upload) =>
        /\.mp4$/i.test(upload.filename) &&
        upload.currentRevisionId &&
        ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
    ),
    uploads.find(
      (upload) =>
        upload.filename === '260629_VLM.pptx' &&
        upload.currentRevisionId &&
        ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
    ),
  ];
  test.skip(
    files.some((file) => !file),
    'The recording/deck corpus pair is absent or has not finished processing on this PC.',
  );
  try {
    await page.goto('/');
    for (const file of files)
      await page
        .locator('.selectable-row')
        .filter({ has: page.locator(`a[href="/staging/${file!.id}"]`) })
        .getByRole('checkbox', {
          name: `Select ${file!.filename}`,
          exact: true,
        })
        .check();
    await expect(
      page.getByRole('heading', { name: /Selected files/ }),
    ).toBeVisible();
    await page.reload();
    for (const file of files)
      await expect(
        page
          .locator('.selectable-row')
          .filter({ has: page.locator(`a[href="/staging/${file!.id}"]`) })
          .getByRole('checkbox', {
            name: `Select ${file!.filename}`,
            exact: true,
          }),
      ).toBeChecked();
    const selected = await (await page.request.get('/api/selections')).json();
    for (const file of files)
      expect(
        selected.find((selection: any) => selection.uploadId === file!.id)
          .revisionId,
      ).toBe(file!.currentRevisionId);
    const pushButton = page.getByRole('button', {
      name: 'Push selected files to memory',
      exact: true,
    });
    if (selected.some((selection: any) => !selection.readyForPush))
      await expect(pushButton).toBeDisabled();
    else await expect(pushButton).toBeEnabled();
    for (const item of selected.filter(
      (selection: any) => !selection.complete,
    )) {
      const selection = page.locator('.selection-item').filter({
        has: page.locator(
          `a[href="/staging/${item.uploadId}?revision=${item.revisionId}"]`,
        ),
      });
      await expect(
        selection.getByRole('checkbox', {
          name: 'Include this partial extraction when pushing',
          exact: true,
        }),
      ).toBeChecked({ checked: item.acceptPartial });
      if (item.warnings.length) {
        const warnings = selection.getByRole('button', {
          name: /coverage warnings/,
        });
        await warnings.click();
        await expect(selection.locator('.disclosure-content')).toContainText(
          item.warnings[0],
        );
      }
    }
  } finally {
    for (const file of files) {
      if (!file) continue;
      const old = initial.find(
        (selection: any) => selection.uploadId === file.id,
      );
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
