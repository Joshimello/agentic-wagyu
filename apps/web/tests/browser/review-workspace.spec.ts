import { expect, type Page, type Route } from '@playwright/test';
import { test } from './fixtures';
import type { Primitive, Stage } from '../../src/lib/server/contracts';

type Text = Extract<Primitive, { kind: 'text' }>;
type Detail = {
  upload: { id: string; currentRevisionId: string; filename: string };
  run: { state: string; progress: string };
  revisions: { id: string; manifest: Stage }[];
  memory: unknown;
};
type Meeting = { detail: Detail; stage: Stage; texts: Text[] };
type Language = 'en' | 'zh-TW';

async function readyMeeting(page: Page): Promise<Meeting> {
  const response = await page.request.get('/api/uploads');
  expect(response.ok()).toBe(true);
  const uploads: {
    id: string;
    filename: string;
    run: { state: string } | null;
  }[] = await response.json();
  const candidates = uploads.filter(
    (upload) =>
      /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(upload.filename) &&
      ['ready', 'ready_with_warnings'].includes(upload.run?.state ?? ''),
  );
  candidates.sort(
    (a, b) =>
      Number(/Real2Sim.*part[_ -]?0?2/i.test(b.filename)) -
      Number(/Real2Sim.*part[_ -]?0?2/i.test(a.filename)),
  );
  for (const candidate of candidates) {
    const detail: Detail = await (
      await page.request.get(`/api/uploads/${candidate.id}`)
    ).json();
    const stage = detail.revisions.find(
      (revision) => revision.id === detail.upload.currentRevisionId,
    )?.manifest;
    const texts =
      stage?.primitives.filter(
        (primitive): primitive is Text => primitive.kind === 'text',
      ) ?? [];
    if (stage && texts.length > 4) return { detail, stage, texts };
  }
  test.skip(
    true,
    'No processed local meeting with more than four transcript entries is available.',
  );
  throw new Error('No ready meeting');
}

async function openReader(page: Page, meeting: Meeting) {
  await page.goto(
    `/staging/${meeting.detail.upload.id}?revision=${meeting.stage.id}`,
  );
  await page
    .getByRole('button', { name: 'Show full transcript', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Full transcript',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

function translatedStatus(
  meeting: Meeting,
  language: Language,
  state: 'not_requested' | 'queued' | 'processing' | 'ready' = 'ready',
) {
  return {
    id:
      state === 'not_requested' ? null : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state,
    revisionId: meeting.stage.id,
    language,
    completedSegments: state === 'ready' ? meeting.texts.length : 0,
    totalSegments: meeting.texts.length,
    translations:
      state === 'ready'
        ? meeting.texts.map((primitive, index) => ({
            primitiveId: primitive.id,
            text:
              language === 'en'
                ? `English reading copy, entry ${index + 1}.`
                : `\u7e41\u9ad4\u4e2d\u6587\u95b1\u8b80\u526f\u672c\uff0c\u7b2c ${index + 1} \u6bb5\u3002`,
          }))
        : [],
    error: null,
    model: 'browser-test-translation',
    promptVersion: 'transcript-translation-1',
    updatedAt: '2026-10-11T00:00:00.000Z',
  };
}

async function fulfillTranslation(
  route: Route,
  meeting: Meeting,
  state: 'not_requested' | 'queued' | 'processing' | 'ready' = 'ready',
) {
  const request = route.request();
  const values =
    request.method() === 'POST'
      ? request.postDataJSON()
      : Object.fromEntries(new URL(request.url()).searchParams);
  expect(values.revisionId).toBe(meeting.stage.id);
  expect(['en', 'zh-TW']).toContain(values.language);
  await route.fulfill({
    status: state === 'queued' ? 202 : 200,
    json: translatedStatus(meeting, values.language as Language, state),
  });
}

async function assertUnchanged(page: Page, meeting: Meeting) {
  const after: Detail = await (
    await page.request.get(`/api/uploads/${meeting.detail.upload.id}`)
  ).json();
  expect(after.upload.currentRevisionId).toBe(
    meeting.detail.upload.currentRevisionId,
  );
  expect(after.revisions).toEqual(meeting.detail.revisions);
  expect(after.memory).toEqual(meeting.detail.memory);
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name}: four-entry preview, keyboard reader, search and progressive transcript loading`, async ({
    page,
  }) => {
    const meeting = await readyMeeting(page);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto(
      `/staging/${meeting.detail.upload.id}?revision=${meeting.stage.id}`,
    );
    await expect(page.locator('.preview-turn')).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    const source = await page.locator('#original-evidence').boundingBox();
    const preview = await page.locator('#spoken-transcript').boundingBox();
    expect(source).toBeTruthy();
    expect(preview).toBeTruthy();
    if (viewport.name === 'desktop')
      expect(Math.abs(source!.height - preview!.height)).toBeLessThan(2);
    else expect(preview!.y).toBeGreaterThanOrEqual(source!.y + source!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);

    const opener = page.getByRole('button', {
      name: 'Show full transcript',
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'Full transcript',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    for (let index = 0; index < 4; index++) {
      await page.keyboard.press('Tab');
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    await expect(dialog.locator('.reader-turn')).toHaveCount(
      Math.min(60, meeting.texts.length),
    );
    if (meeting.texts.length > 60) {
      await dialog
        .getByRole('button', { name: 'Show more', exact: true })
        .click();
      await expect(dialog.locator('.reader-turn')).toHaveCount(
        Math.min(120, meeting.texts.length),
      );
    }
    const searchable =
      meeting.texts.find((primitive) => primitive.text.trim().length >= 12) ??
      meeting.texts[0];
    const phrase = searchable.text.trim().slice(0, 12);
    const search = dialog.getByRole('searchbox', { name: 'Search transcript' });
    await search.fill(phrase);
    await expect(dialog.locator('.reader-turn').first()).toContainText(phrase);
    expect(
      await dialog
        .locator('.reader-turn p')
        .evaluateAll(
          (paragraphs, query) =>
            paragraphs.every((paragraph) =>
              paragraph.textContent?.toLocaleLowerCase().includes(query),
            ),
          phrase.toLocaleLowerCase(),
        ),
    ).toBe(true);
    await search.fill(`browser-no-match-${crypto.randomUUID()}`);
    await expect(
      dialog.getByRole('heading', { name: 'No matching entries' }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Clear search', exact: true })
      .click();
    await expect(search).toHaveValue('');
    await expect(dialog.locator('.reader-turn')).toHaveCount(
      Math.min(60, meeting.texts.length),
    );
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await expect(page.locator('.preview-turn')).toHaveCount(4);
    await assertUnchanged(page, meeting);
  });
}

test('language copies, queued progress and editing preserve original evidence and correction revision pins', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  const endpoint = `/api/uploads/${meeting.detail.upload.id}/translations`;
  let requested = false;
  let statusReads = 0;
  await page.route(`**${endpoint}*`, async (route) => {
    if (route.request().method() === 'POST') {
      requested = true;
      expect(route.request().postDataJSON()).toEqual({
        revisionId: meeting.stage.id,
        language: 'en',
      });
      await fulfillTranslation(route, meeting, 'queued');
    } else {
      const language = new URL(route.request().url()).searchParams.get(
        'language',
      );
      if (language === 'en') statusReads++;
      await fulfillTranslation(
        route,
        meeting,
        language === 'en' && !requested ? 'not_requested' : 'ready',
      );
    }
  });
  const dialog = await openReader(page, meeting);
  const languages = dialog.getByRole('group', { name: 'Transcript language' });
  await expect(
    languages.getByRole('button', { name: 'Original', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await languages.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(
    dialog.getByRole('progressbar', { name: 'Translation progress' }),
  ).toBeVisible();
  await expect.poll(() => requested).toBe(true);
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    'English reading copy, entry 1.',
  );
  expect(statusReads).toBeGreaterThanOrEqual(2);
  await expect(dialog.locator('.reader-content')).toHaveAttribute('lang', 'en');
  await expect(dialog.locator('.reader-footer')).toContainText(
    'Machine translation',
  );
  await expect(
    dialog.getByRole('button', { name: 'Edit original', exact: true }),
  ).toBeVisible();
  await languages
    .getByRole('button', { name: '\u7e41\u4e2d', exact: true })
    .click();
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    '\u7e41\u9ad4\u4e2d\u6587\u95b1\u8b80\u526f\u672c\uff0c\u7b2c 1 \u6bb5\u3002',
  );
  await expect(dialog.locator('.reader-content')).toHaveAttribute(
    'lang',
    'zh-TW',
  );

  let correction:
    | {
        baseRevisionId: string;
        edits: { primitiveId: string; text: string; speaker: string | null }[];
      }
    | undefined;
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/corrections`,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      correction = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        json: {
          error: 'Browser check intercepted this draft; no evidence was saved.',
        },
      });
    },
  );
  await dialog
    .getByRole('button', { name: 'Edit original', exact: true })
    .click();
  await expect(
    languages.getByRole('button', { name: 'Original', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    languages.getByRole('button', { name: 'EN', exact: true }),
  ).toBeDisabled();
  await expect(
    languages.getByRole('button', { name: '\u7e41\u4e2d', exact: true }),
  ).toBeDisabled();
  const draft = dialog.getByRole('textbox', {
    name: 'Text for entry 1',
    exact: true,
  });
  await expect(draft).toHaveValue(meeting.texts[0].text);
  await expect(
    dialog.getByRole('button', { name: 'Save corrections', exact: true }),
  ).toBeDisabled();
  await draft.fill(`${meeting.texts[0].text}\nBrowser review draft`);
  await dialog
    .getByRole('button', { name: 'Save corrections', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'no evidence was saved',
  );
  expect(correction?.baseRevisionId).toBe(meeting.stage.id);
  expect(correction?.edits).toEqual([
    {
      primitiveId: meeting.texts[0].id,
      text: `${meeting.texts[0].text}\nBrowser review draft`,
      speaker: meeting.texts[0].speaker,
    },
  ]);
  await dialog
    .getByRole('button', { name: 'Cancel editing', exact: true })
    .click();
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await expect(dialog.locator('.reader-footer')).toContainText(
    'Original evidence',
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.preview-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await assertUnchanged(page, meeting);
});

test('a late English response cannot replace the selected Traditional Chinese copy', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  // Keep this one request alive to exercise stale-response guards as well as aborts.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const browserFetch = (
      input: Parameters<typeof window.fetch>[0],
      options?: Parameters<typeof window.fetch>[1],
    ) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes('/translations?') && url.includes('language=en')) {
        const { signal: ignoredSignal, ...rest } = options ?? {};
        return originalFetch(input, rest);
      }
      return originalFetch(input, options);
    };
    window.fetch = browserFetch as typeof window.fetch;
  });
  let releaseEnglish!: () => void;
  const delayedEnglish = new Promise<void>(
    (resolve) => (releaseEnglish = resolve),
  );
  let englishStarted = false;
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/translations*`,
    async (route) => {
      if (
        new URL(route.request().url()).searchParams.get('language') === 'en'
      ) {
        englishStarted = true;
        await delayedEnglish;
      }
      await fulfillTranslation(route, meeting);
    },
  );
  const dialog = await openReader(page, meeting);
  const languages = dialog.getByRole('group', { name: 'Transcript language' });
  await languages.getByRole('button', { name: 'EN', exact: true }).click();
  await expect.poll(() => englishStarted).toBe(true);
  await languages
    .getByRole('button', { name: '\u7e41\u4e2d', exact: true })
    .click();
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    '\u7e41\u9ad4\u4e2d\u6587\u95b1\u8b80\u526f\u672c\uff0c\u7b2c 1 \u6bb5\u3002',
  );
  const oldResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/translations?') &&
      response.url().includes('language=en'),
  );
  releaseEnglish();
  await (await oldResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    languages.getByRole('button', { name: '\u7e41\u4e2d', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.reader-content')).toHaveAttribute(
    'lang',
    'zh-TW',
  );
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    '\u7e41\u9ad4\u4e2d\u6587\u95b1\u8b80\u526f\u672c\uff0c\u7b2c 1 \u6bb5\u3002',
  );
  await languages
    .getByRole('button', { name: 'Original', exact: true })
    .click();
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await assertUnchanged(page, meeting);
});

test('same-revision processing polls preserve the chosen reading language', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/translations*`,
    (route) => fulfillTranslation(route, meeting),
  );
  let detailReads = 0;
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}`,
    async (route) => {
      expect(route.request().method()).toBe('GET');
      detailReads++;
      await route.fulfill({
        json: {
          ...meeting.detail,
          run: {
            ...meeting.detail.run,
            state: 'processing',
            progress: 'Browser polling check',
          },
        },
      });
    },
  );
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/retry`,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({
        status: 202,
        json: { runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      });
    },
  );
  const dialog = await openReader(page, meeting);
  await dialog.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    'English reading copy, entry 1.',
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page
    .getByRole('button', { name: 'Reprocess original', exact: true })
    .click();
  await expect.poll(() => detailReads).toBeGreaterThanOrEqual(2);
  await page
    .getByRole('button', { name: 'Show full transcript', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'EN', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    'English reading copy, entry 1.',
  );
  await assertUnchanged(page, meeting);
});

test('a pinned evidence revision keeps its transcript, captions and exports separate', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  const historical = meeting.detail.revisions.find(
    (revision) =>
      revision.id !== meeting.detail.upload.currentRevisionId &&
      revision.manifest.primitives.some(
        (primitive) => primitive.kind === 'text',
      ),
  ) ?? { id: meeting.stage.id, manifest: meeting.stage };
  const stage = historical.manifest;
  const texts = stage.primitives.filter(
    (primitive): primitive is Text => primitive.kind === 'text',
  );
  await page.goto(`/staging/${meeting.detail.upload.id}?revision=${stage.id}`);
  await expect(page.locator('video track')).toHaveAttribute(
    'src',
    `/api/uploads/${meeting.detail.upload.id}/captions?revision=${stage.id}`,
  );
  await expect(page.locator('.preview-turn p').first()).toHaveText(
    texts[0].text,
  );
  const exportMenu = page.getByRole('button', { name: 'Export', exact: true });
  await expect(exportMenu).toHaveAttribute('aria-busy', 'false');
  await exportMenu.click();
  await expect(exportMenu).toHaveAttribute('aria-expanded', 'true');
  const jsonLink = page.getByRole('link', { name: 'JSON', exact: true });
  await expect(jsonLink).toBeVisible();
  const href = await jsonLink.getAttribute('href');
  expect(href).toContain(`revision=${stage.id}`);
  const exported = await page.request.get(href!);
  expect(exported.ok()).toBe(true);
  expect((await exported.json()).id).toBe(stage.id);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Show full transcript', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Full transcript',
    exact: true,
  });
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    texts[0].text,
  );
  if (stage.id !== meeting.detail.upload.currentRevisionId)
    await expect(
      dialog.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(0);
  await assertUnchanged(page, meeting);
});

test('Export waits for hydration and the first enabled click opens the pinned actions', async ({
  page,
}) => {
  test.setTimeout(20000);
  const meeting = await readyMeeting(page);
  let releaseScripts!: () => void;
  const scriptsHeld = new Promise<void>(
    (resolve) => (releaseScripts = resolve),
  );
  let entryRequests = 0;
  await page.route('**/*', async (route) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()))
      return route.abort();
    if (route.request().url().includes('/_app/immutable/entry/')) {
      entryRequests++;
      await scriptsHeld;
    }
    await route.continue();
  });
  try {
    await page.goto(
      `/staging/${meeting.detail.upload.id}?revision=${meeting.stage.id}`,
      { waitUntil: 'domcontentloaded' },
    );
    const exportMenu = page.getByRole('button', {
      name: 'Export',
      exact: true,
    });
    await expect.poll(() => entryRequests).toBeGreaterThan(0);
    await expect(exportMenu).toBeDisabled();
    await expect(exportMenu).toHaveAttribute('aria-busy', 'true');
    releaseScripts();
    await expect(exportMenu).toBeEnabled();
    await expect(exportMenu).toHaveAttribute('aria-busy', 'false');
    await exportMenu.click();
    await expect(exportMenu).toHaveAttribute('aria-expanded', 'true');
    const jsonLink = page.getByRole('link', { name: 'JSON', exact: true });
    await expect(jsonLink).toBeVisible();
    expect(await jsonLink.getAttribute('href')).toContain(
      `revision=${meeting.stage.id}`,
    );
    await assertUnchanged(page, meeting);
  } finally {
    releaseScripts();
  }
});
