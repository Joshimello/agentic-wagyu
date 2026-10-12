import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const queuedId = '11111111-1111-4111-8111-111111111111';
const readyId = '22222222-2222-4222-8222-222222222222';
const savedId = '44444444-4444-4444-8444-444444444444';
const revisionId = '33333333-3333-4333-8333-333333333333';
const metadata = {
  uploader: 'local',
  uploadedAt: '2026-10-11T00:00:00.000Z',
  sourceTime: null,
  sourceTimeOrigin: 'unknown',
};

function source(id: string, filename: string, ready = false) {
  return {
    id,
    filename,
    metadata: { ...metadata, label: filename },
    currentRevisionId: ready ? revisionId : null,
    bytes: 1024,
    run: {
      state: ready ? 'ready' : 'processing',
      progress: ready ? 'Ready for review' : 'Transcribing window 2 of 4',
      progressPercent: ready ? 100 : 43,
    },
    memory: { state: 'never_pushed', commitVersion: null as number | null },
  };
}

type Selection = {
  uploadId: string;
  revisionId: string;
  acceptPartial: boolean;
  filename: string;
  metadata: typeof metadata & { label: string };
  warnings: string[];
  stale: boolean;
  complete: boolean;
  readyForPush: boolean;
};

async function rejectBrowserWrites(page: Page) {
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 409,
      json: { error: 'Unexpected browser mutation blocked by the test.' },
    });
    expect(method, 'Home checks must intercept every mutation').toMatch(
      /^(GET|HEAD|OPTIONS)$/,
    );
  });
}

async function isolatedHome(page: Page, includeSaved = false) {
  let sources = [
    source(queuedId, 'Processing meeting.mp4'),
    source(readyId, 'Reviewed meeting.mp4', true),
  ];
  if (includeSaved) {
    const saved = source(savedId, 'Saved meeting.mp4', true);
    sources.push({
      ...saved,
      run: { ...saved.run, state: 'ready_with_warnings' },
      memory: { state: 'incorporated', commitVersion: 3 },
    });
  }
  let selections: Selection[] = [];
  const removed: string[][] = [];
  const selectionWrites: unknown[] = [];
  await rejectBrowserWrites(page);
  await page.route('**/api/uploads', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: sources });
  });
  await page.route('**/api/selections', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const item = request.postDataJSON();
      selectionWrites.push(item);
      const upload = sources.find((file) => file.id === item.uploadId)!;
      selections = [
        ...selections.filter((selected) => selected.uploadId !== item.uploadId),
        {
          ...item,
          filename: upload.filename,
          metadata: upload.metadata,
          warnings: [],
          stale: false,
          complete: true,
          readyForPush: true,
        },
      ];
    } else if (request.method() === 'DELETE') {
      const item = request.postDataJSON();
      selections = selections.filter(
        (selected) => selected.uploadId !== item.uploadId,
      );
    }
    await route.fulfill({ json: selections });
  });
  await page.route('**/api/uploads/remove', async (route) => {
    expect(route.request().method()).toBe('POST');
    const { uploadIds } = route.request().postDataJSON();
    removed.push(uploadIds);
    sources = sources.filter((file) => !uploadIds.includes(file.id));
    selections = selections.filter(
      (item) => !uploadIds.includes(item.uploadId),
    );
    await route.fulfill({ json: { removedIds: uploadIds } });
  });
  await page.goto('/');
  await expect(
    page.getByText('Processing meeting.mp4', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Push To Memory', exact: true }),
  ).toHaveCount(0);
  return { removed, selectionWrites, get sources() { return sources; } };
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name}: source details create a project, preserve canceled drafts, and return a source to No project`, async ({ page }) => {
    const home = await isolatedHome(page);
    await page.setViewportSize(viewport);
    await expect(page.locator('.group-label strong').filter({ hasText: /^No project$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit details for Processing meeting.mp4', exact: true })).toBeDisabled();
    const writes: { label: string; sourceTime: string | null; projectName: string }[] = [];
    await page.route(`**/api/uploads/${readyId}`, async (route) => {
      expect(route.request().method()).toBe('PATCH');
      const value = route.request().postDataJSON();
      writes.push(value);
      const source = home.sources.find((source) => source.id === readyId)!;
      source.metadata = { ...source.metadata, label: value.label, sourceTime: value.sourceTime, groupHint: value.projectName } as typeof source.metadata;
      source.currentRevisionId = crypto.randomUUID();
      await route.fulfill({ json: { saved: true } });
    });
    await page.getByRole('button', { name: 'Edit details for Reviewed meeting.mp4', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit details', exact: true });
    const projects = dialog.getByRole('combobox', { name: /^Project / });
    if (process.env.EXPECT_EMPTY_PROJECTS === '1') await expect(projects).toHaveCount(0);
    else if (await projects.count()) {
      await projects.click();
      await dialog.getByRole('option', { name: 'Custom', exact: true }).click();
    }
    await dialog.getByLabel('Name', { exact: true }).fill('Week 2 planning');
    await dialog.getByLabel('Meeting date and time (optional)', { exact: true }).fill('2026-09-23T10:30');
    await dialog.getByLabel('Project name (optional)', { exact: true }).fill('Continuity project');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await dialog.screenshot({ path: `${process.env.BROWSER_RESULTS ?? '/data/browser-results'}/source-details-${viewport.name}.png` });
    await dialog.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ label: 'Week 2 planning', sourceTime: '2026-09-23T10:30:00.000Z', projectName: 'Continuity project' });
    await expect(page.locator('.group-label strong').filter({ hasText: /^Continuity project$/ })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Edit details for Week 2 planning', exact: true }).click();
    await expect(projects).toBeVisible();
    await projects.click();
    await expect(dialog.getByRole('option', { name: 'Continuity project', exact: true })).toBeVisible();
    await dialog.getByRole('option', { name: 'Custom', exact: true }).click();
    await dialog.getByLabel('Project name (optional)', { exact: true }).fill('Unsaved project');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(writes).toHaveLength(1);
    await expect(page.locator('.group-label strong').filter({ hasText: /^Continuity project$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Edit details for Week 2 planning', exact: true }).click();
    await projects.click();
    await dialog.getByRole('option', { name: 'No project', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save details', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1].projectName).toBe('');
    await expect(page.locator('.group-label strong')).toHaveText(['No project']);
    expect(home.sources.find((source) => source.id === readyId)!.filename).toBe('Reviewed meeting.mp4');
  });
}

test('saved sources show their memory status and remain removable without a push menu', async ({
  page,
}) => {
  const { removed, selectionWrites } = await isolatedHome(page, true);
  const row = page
    .locator('.selectable-row')
    .filter({ hasText: 'Saved meeting.mp4' });
  await expect(row.getByText('Added to memory', { exact: true })).toBeVisible();
  await expect(row).not.toContainText('ready with warnings');
  await row.getByRole('checkbox').check();
  expect(selectionWrites).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Push To Memory', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: /Project matching/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove selected', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('checkbox', { name: 'Select Reviewed meeting.mp4', exact: true })
    .check();
  await expect(
    page.getByRole('button', { name: 'Push To Memory', exact: true }),
  ).toBeEnabled();
  expect(selectionWrites).toEqual([
    { uploadId: readyId, revisionId, acceptPartial: false },
  ]);
  await page
    .getByRole('button', { name: 'Remove selected', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Remove selected files from Staging?' })
    .getByRole('button', { name: 'Remove files', exact: true })
    .click();
  expect(removed).toHaveLength(1);
  expect([...removed[0]].sort()).toEqual([readyId, savedId].sort());
});

test('choosing and clearing files controls upload details without sending an upload', async ({
  page,
}) => {
  await isolatedHome(page);
  const submit = page.getByRole('button', {
    name: 'Upload to staging',
    exact: true,
  });
  const details = page.getByRole('button', {
    name: 'Upload details',
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await page.getByLabel('Source files', { exact: true }).setInputFiles({
    name: 'Research meeting.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('Local browser file selection test'),
  });
  await expect(submit).toBeEnabled();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Uploaded by', { exact: true }).fill('Research group');
  const projects = page.getByRole('combobox', { name: /^Project / });
  if (await projects.count()) {
    await projects.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
  }
  await page
    .getByLabel('Project name (optional)')
    .fill('Real2Sim review');
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(page.getByLabel('Uploaded by', { exact: true })).toHaveValue(
    'Research group',
  );
  await expect(page.getByLabel('Project name (optional)')).toHaveValue(
    'Real2Sim review',
  );
  await page
    .getByRole('button', { name: 'Clear source files', exact: true })
    .click();
  await expect(submit).toBeDisabled();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  expect(
    await page
      .getByLabel('Source files', { exact: true })
      .evaluate((node: HTMLInputElement) => node.files?.length),
  ).toBe(0);
});

test('dropping a file updates the real upload field, while non-file drops are ignored', async ({
  page,
}) => {
  await isolatedHome(page);
  const region = page.getByRole('region', {
    name: 'Add source files',
    exact: true,
  });
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(['Drop test content'], 'Dropped meeting.mp4', {
        type: 'video/mp4',
      }),
    );
    return data;
  });
  await region.dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(region).toHaveClass(/dragging/);
  await region.dispatchEvent('dragover', { dataTransfer: transfer });
  await region.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(region).not.toHaveClass(/dragging/);
  await expect(
    page.getByRole('button', { name: 'Upload details', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  const fileNames = await page
    .getByLabel('Source files', { exact: true })
    .evaluate((node: HTMLInputElement) =>
      Array.from(node.files ?? [], (file) => file.name),
    );
  expect(fileNames).toEqual(['Dropped meeting.mp4']);
  await expect(
    page.getByRole('button', { name: 'Upload to staging', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Clear source files', exact: true })
    .click();
  const textTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'This is not a source file');
    return data;
  });
  await region.dispatchEvent('dragenter', { dataTransfer: textTransfer });
  await region.dispatchEvent('drop', { dataTransfer: textTransfer });
  await expect(region).not.toHaveClass(/dragging/);
  await expect(
    page.getByRole('button', { name: 'Upload to staging', exact: true }),
  ).toBeDisabled();
  await transfer.dispose();
  await textTransfer.dispose();
});

test('processing sources can be selected for removal without silently pushing only ready sources', async ({
  page,
}) => {
  const { removed, selectionWrites } = await isolatedHome(page);
  await page
    .getByRole('checkbox', {
      name: 'Select Processing meeting.mp4',
      exact: true,
    })
    .check();
  expect(selectionWrites).toEqual([]);
  await page
    .getByRole('checkbox', { name: 'Select Reviewed meeting.mp4', exact: true })
    .check();
  await expect(
    page.getByRole('button', { name: 'Push To Memory', exact: true }),
  ).toBeDisabled();
  expect(selectionWrites).toEqual([
    { uploadId: readyId, revisionId, acceptPartial: false },
  ]);
  await page
    .getByRole('button', { name: 'Remove selected', exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Remove selected files from Staging?',
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(
    'Saved memory and evidence are kept.',
  );
  await confirmation
    .getByRole('button', { name: 'Keep files', exact: true })
    .click();
  expect(removed).toEqual([]);
  await page
    .getByRole('button', { name: 'Remove selected', exact: true })
    .click();
  await confirmation
    .getByRole('button', { name: 'Remove files', exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  expect(removed).toHaveLength(1);
  expect([...removed[0]].sort()).toEqual([queuedId, readyId].sort());
  await expect(
    page.getByText('Your sources will appear here', { exact: true }),
  ).toBeVisible();
  // Every write in this test is intercepted; no local recording is removed.
});

test('larger sans-serif UI fits a narrow viewport with aligned menu controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await isolatedHome(page);
  const style = await page.evaluate(() => ({
    size: getComputedStyle(document.documentElement).fontSize,
    family: getComputedStyle(document.querySelector('h1')!).fontFamily,
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(style.size).toBe('18.75px');
  expect(style.family).toContain('Geist');
  expect(style.content).toBeLessThanOrEqual(style.viewport);
  const input = page.getByLabel('Source files', { exact: true });
  await expect(input).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Select Reviewed meeting.mp4', exact: true })
    .check();
  const project = page.getByRole('combobox', { name: /Project matching/ });
  await project.click();
  const option = page.getByRole('option', {
    name: 'Automatic, based on content',
    exact: true,
  });
  await expect(option).toBeVisible();
  expect(
    await option.evaluate((node) => getComputedStyle(node).textAlign),
  ).toBe('left');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

const responsiveWidths = [320, 390, 768, 1440];

async function captureResponsive(
  page: Page,
  scene: 'home' | 'detail',
  path: string,
) {
  for (const width of responsiveWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `/data/evaluations/ui-controls-${scene}-${width}.png`,
      fullPage: false,
    });
    const geometry = await page.evaluate(() => ({
      size: getComputedStyle(document.documentElement).fontSize,
      viewport: window.innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect
      .soft(
        geometry.size,
        `${scene} ${width}px uses the requested readable font scale`,
      )
      .toBe('18.75px');
    expect
      .soft(
        geometry.content,
        `${scene} ${width}px must fit without horizontal scrolling`,
      )
      .toBeLessThanOrEqual(geometry.viewport);
  }
}

test('home stays readable across viewport sizes without horizontal overflow', async ({
  page,
}) => {
  await rejectBrowserWrites(page);
  await captureResponsive(page, 'home', '/');
});

test('a reviewed recording fits mobile, tablet, and desktop without horizontal overflow', async ({
  page,
}) => {
  const response = await page.request.get('/api/uploads');
  expect(response.ok()).toBe(true);
  const files: {
    id: string;
    filename: string;
    currentRevisionId: string | null;
    run: { state: string } | null;
  }[] = await response.json();
  const reviewed = files.filter(
    (file) =>
      /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.filename) &&
      file.currentRevisionId &&
      ['ready', 'ready_with_warnings'].includes(file.run?.state ?? ''),
  );
  reviewed.sort(
    (a, b) =>
      Number(/Real2Sim/i.test(b.filename)) -
      Number(/Real2Sim/i.test(a.filename)),
  );
  test.skip(
    !reviewed.length,
    'No processed local recording is available for responsive detail review.',
  );
  const file = reviewed[0];
  const before = await (
    await page.request.get(`/api/uploads/${file.id}`)
  ).json();
  await rejectBrowserWrites(page);
  await captureResponsive(
    page,
    'detail',
    `/staging/${file.id}?revision=${file.currentRevisionId}`,
  );
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Edit details', exact: true });
  await expect(details.getByLabel('Name', { exact: true })).toHaveValue(before.upload.metadata.label || before.upload.filename);
  await expect(details.getByRole('combobox', { name: /^Project / })).toBeVisible();
  await details.getByRole('button', { name: 'Cancel', exact: true }).click();
  const after = await (
    await page.request.get(`/api/uploads/${file.id}`)
  ).json();
  expect(after.upload.currentRevisionId).toBe(before.upload.currentRevisionId);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.memory).toEqual(before.memory);
});
