import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import type { Primitive, Stage } from '../../src/lib/server/contracts';
import type { TranslationStatus } from '../../src/lib/server/contracts/translations';

type Text = Extract<Primitive, { kind: 'text' }>;
type Detail = {
  upload: {
    id: string;
    currentRevisionId: string;
    filename: string;
    [key: string]: unknown;
  };
  run: {
    id: string;
    state: string;
    progress: string;
    progressPercent: number;
    error: string | null;
    [key: string]: unknown;
  };
  revisions: { id: string; createdAt: string; manifest: Stage }[];
  memory: unknown;
  [key: string]: unknown;
};
type Meeting = { detail: Detail; stage: Stage; texts: Text[] };
type PushInput = {
  idempotencyKey: string;
  items: { uploadId: string; revisionId: string; acceptPartial: boolean }[];
  projectScope: { mode: string; name?: string; projectId?: string };
};

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextRevisionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const translationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
      Number(/Real2Sim/i.test(b.filename)) -
      Number(/Real2Sim/i.test(a.filename)),
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
    if (
      stage &&
      texts.length > 4 &&
      ['ready', 'ready_with_warnings'].includes(detail.run.state)
    )
      return { detail, stage, texts };
  }
  test.skip(
    true,
    'No processed local recording with a full transcript is available.',
  );
  throw new Error('No ready meeting');
}

async function blockUnhandledWrites(page: Page) {
  const writes: { method: string; url: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      await route.continue();
      return;
    }
    writes.push({ method: request.method(), url: request.url() });
    await route.fulfill({
      status: 409,
      json: { error: 'Unexpected browser mutation blocked by the test.' },
    });
  });
  return writes;
}

async function assertEvidenceUnchanged(page: Page, meeting: Meeting) {
  const actual: Detail = await (
    await page.request.get(`/api/uploads/${meeting.detail.upload.id}`)
  ).json();
  expect(actual.upload.currentRevisionId).toBe(
    meeting.detail.upload.currentRevisionId,
  );
  expect(actual.revisions.map((revision) => revision.id)).toEqual(
    meeting.detail.revisions.map((revision) => revision.id),
  );
  expect(
    actual.revisions.find((revision) => revision.id === meeting.stage.id)
      ?.manifest,
  ).toEqual(meeting.stage);
  expect(actual.memory).toEqual(meeting.detail.memory);
}

async function revisit(page: Page) {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page
    .getByRole('button', { name: 'Revisit visual context', exact: true })
    .click();
}

test('visual reprocessing shows measured progress and cancellation preserves the reviewed revision', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  const unexpected = await blockUnhandledWrites(page);
  const view = structuredClone(meeting.detail);
  let retryBody: unknown;
  let cancelBody: unknown;
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/retry`,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      retryBody = route.request().postDataJSON();
      view.run = {
        ...view.run,
        id: runId,
        state: 'processing',
        progress: 'Reviewing visual context',
        progressPercent: 42,
        error: null,
      };
      await route.fulfill({ status: 202, json: { runId } });
    },
  );
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}`,
    async (route) => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: view });
    },
  );
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/cancel`,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      cancelBody = route.request().postDataJSON();
      view.run = {
        ...view.run,
        state: 'canceled',
        progress: 'Canceled / completed work is saved',
      };
      await route.fulfill({ json: { run: view.run } });
    },
  );
  await page.goto(`/staging/${meeting.detail.upload.id}`);
  await revisit(page);
  const progress = page.locator('.processing-strip').getByRole('progressbar');
  await expect(progress).toHaveAttribute('aria-valuenow', '42');
  await expect(page.locator('.processing-strip')).toContainText('42%');
  expect(retryBody).toEqual({ inputRevisionId: meeting.stage.id });
  await expect(page.locator('.preview-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await page
    .locator('.processing-strip')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.locator('.processing-strip')).toHaveCount(0);
  await expect(page.locator('.status-row')).toContainText('Canceled');
  await expect(
    page.getByText(
      'Processing canceled. Completed work and earlier revisions are saved.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(cancelBody).toEqual({ runId });
  await expect(page.locator('.preview-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reprocess original', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Revisit visual context', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  expect(unexpected).toEqual([]);
  await assertEvidenceUnchanged(page, meeting);
});

test('detail publishing protects pending choices and separates changed payloads from identical retries', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  const unexpected = await blockUnhandledWrites(page);
  let view = structuredClone(meeting.detail);
  view.memory = {
    state: 'never_pushed',
    revisionId: null,
    pushId: null,
    commitVersion: null,
    admittedRevisionIds: [],
  };
  const partial = view.revisions.find(
    (revision) => revision.id === meeting.stage.id,
  )!.manifest;
  partial.coverage.complete = false;
  partial.coverage.warnings = ['The final discussion segment needs review.'];
  const posts: PushInput[] = [];
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/retry`,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({
        inputRevisionId: meeting.stage.id,
      });
      view.run = {
        ...view.run,
        id: runId,
        state: 'processing',
        progress: 'Reviewing visual context',
        progressPercent: 42,
      };
      await route.fulfill({ status: 202, json: { runId } });
    },
  );
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}`,
    async (route) => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: view });
    },
  );
  await page.route('**/api/pushes', async (route) => {
    expect(route.request().method()).toBe('POST');
    posts.push(route.request().postDataJSON());
    if (posts.length === 1) await firstResponse;
    await route.fulfill({
      status: 409,
      json: {
        error:
          'Browser validation intercepted publication; no memory was changed.',
      },
    });
  });
  await page.goto(`/staging/${meeting.detail.upload.id}`);
  await revisit(page);
  await expect(
    page.locator('.processing-strip').getByRole('progressbar'),
  ).toHaveAttribute('aria-valuenow', '42');
  await page
    .getByRole('button', { name: 'Push To Memory', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Push To Memory',
    exact: true,
  });
  const publish = dialog.getByRole('button', {
    name: 'Push To Memory',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(publish).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Review notes (1)', exact: true })
    .click();
  await expect(
    dialog.getByText('The final discussion segment needs review.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole('checkbox', {
      name: 'Include this partial extraction',
      exact: true,
    })
    .check();
  await dialog
    .getByRole('button', { name: 'Project matching', exact: true })
    .click();
  const project = dialog.getByRole('combobox', { name: /^Project / });
  await expect(publish).toBeEnabled();
  await publish.click();
  try {
    await expect.poll(() => posts.length).toBe(1);
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(
      dialog.getByRole('button', { name: 'Starting...', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('checkbox', {
        name: 'Include this partial extraction',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Review notes (1)', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Project matching', exact: true }),
    ).toBeDisabled();
    await expect(project).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Close push dialog', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Back', exact: true }),
    ).toBeDisabled();
  } finally {
    releaseFirst();
  }
  await expect(dialog.getByRole('alert')).toContainText(
    'no memory was changed',
  );
  expect(posts).toHaveLength(1);
  expect(posts[0].items).toEqual([
    {
      uploadId: meeting.detail.upload.id,
      revisionId: meeting.stage.id,
      acceptPartial: true,
    },
  ]);
  expect(posts[0].projectScope).toEqual({ mode: 'auto' });
  expect(posts[0].idempotencyKey).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
  );
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await publish.click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(dialog.getByRole('alert')).toContainText(
    'no memory was changed',
  );
  expect(posts[1]).toEqual(posts[0]);

  const newer = structuredClone(
    view.revisions.find((revision) => revision.id === meeting.stage.id)!,
  );
  newer.id = nextRevisionId;
  newer.manifest.id = nextRevisionId;
  newer.createdAt = new Date(Date.parse(newer.createdAt) + 1000).toISOString();
  newer.manifest.createdAt = newer.createdAt;
  view = {
    ...view,
    upload: { ...view.upload, currentRevisionId: nextRevisionId },
    revisions: [newer, ...view.revisions],
  };
  await expect(
    dialog.getByText(
      'A newer revision is available. This push keeps the revision you opened.',
      { exact: true },
    ),
  ).toBeVisible();
  await project.click();
  await dialog
    .getByRole('option', { name: 'Create a project', exact: true })
    .click();
  await expect(publish).toBeDisabled();
  await dialog
    .getByLabel('Project name', { exact: true })
    .fill('  Real2Sim working notes  ');
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect.poll(() => posts.length).toBe(3);
  await expect(dialog.getByRole('alert')).toContainText(
    'no memory was changed',
  );
  expect(posts[2].projectScope).toEqual({
    mode: 'new',
    name: 'Real2Sim working notes',
  });
  expect(posts[2].items).toEqual(posts[0].items);
  expect(posts[2].idempotencyKey).not.toBe(posts[0].idempotencyKey);
  await dialog
    .getByRole('button', { name: 'Close push dialog', exact: true })
    .click();
  expect(unexpected).toEqual([]);
  await assertEvidenceUnchanged(page, meeting);
});

test('translation cancellation preserves cached progress and resumes the same reading copy', async ({
  page,
}) => {
  const meeting = await readyMeeting(page);
  const unexpected = await blockUnhandledWrites(page);
  let state: TranslationStatus['state'] = 'processing';
  const completed = Math.max(1, Math.floor(meeting.texts.length / 4));
  const cancellations: unknown[] = [];
  const resumes: unknown[] = [];
  function status(): TranslationStatus {
    const ready = state === 'ready';
    return {
      id: translationId,
      state,
      revisionId: meeting.stage.id,
      language: 'en',
      progressPercent: ready ? 100 : 25,
      completedSegments: ready ? meeting.texts.length : completed,
      totalSegments: meeting.texts.length,
      translations: meeting.texts
        .slice(0, ready ? meeting.texts.length : completed)
        .map((text, index) => ({
          primitiveId: text.id,
          text: `English reading copy, entry ${index + 1}.`,
        })),
      error: null,
      model: 'browser-test-translation',
      promptVersion: 'transcript-translation-1',
      updatedAt: '2026-10-11T00:00:00.000Z',
    };
  }
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/translations*`,
    async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        resumes.push(request.postDataJSON());
        state = 'queued';
      } else {
        const parameters = new URL(request.url()).searchParams;
        expect(parameters.get('revisionId')).toBe(meeting.stage.id);
        expect(parameters.get('language')).toBe('en');
      }
      await route.fulfill({
        status: request.method() === 'POST' ? 202 : 200,
        json: status(),
      });
    },
  );
  await page.route(
    `**/api/uploads/${meeting.detail.upload.id}/translations/cancel`,
    async (route) => {
      expect(route.request().method()).toBe('POST');
      cancellations.push(route.request().postDataJSON());
      state = 'canceled';
      await route.fulfill({ json: status() });
    },
  );
  await page.goto(`/staging/${meeting.detail.upload.id}`);
  await page
    .getByRole('button', { name: 'Show full transcript', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Full transcript',
    exact: true,
  });
  const language = dialog.getByRole('group', { name: 'Transcript language' });
  await language.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  await expect(dialog.locator('.translation-progress')).toContainText(
    `${completed} / ${meeting.texts.length} entries`,
  );
  await dialog
    .getByRole('button', { name: 'Cancel translation', exact: true })
    .click();
  await expect(
    dialog.getByRole('heading', { name: 'Translation canceled', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Completed translation work is saved.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  expect(cancellations).toEqual([{ translationId }]);
  expect(resumes).toEqual([]);
  await dialog
    .getByRole('button', { name: 'Resume translation', exact: true })
    .click();
  await expect.poll(() => resumes.length).toBe(1);
  expect(resumes).toEqual([{ revisionId: meeting.stage.id, language: 'en' }]);
  await expect(
    dialog.getByRole('button', { name: 'Cancel translation', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  state = 'ready';
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    'English reading copy, entry 1.',
  );
  await language.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(dialog.locator('.reader-turn p').first()).toHaveText(
    meeting.texts[0].text,
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  expect(unexpected).toEqual([]);
  await assertEvidenceUnchanged(page, meeting);
});
