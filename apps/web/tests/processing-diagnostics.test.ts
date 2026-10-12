import { expect, test } from 'bun:test';
import { rm, appendFile } from 'node:fs/promises';
import { assetPath } from '../src/lib/server/storage';
import { processingMayResume } from '../src/lib/processing-status';
import {
  describeProcessingFailure,
  recordProcessingEvent,
  readProcessingEvents,
  redactDiagnostic,
} from '../src/lib/server/agents/interpreter/diagnostics';

test('processing failures retain causes while redacting credentials from diagnostics', () => {
  const error = new Error(
    'Request failed at https://user:password@example.test?api_key=test-secret',
    {
      cause: new Error('Authorization: Bearer private-access-token'),
    },
  );
  const failure = describeProcessingFailure(error);
  expect(failure.message).toContain('[redacted]');
  expect(failure.stack).toContain('Caused by:');
  expect(failure.stack).not.toContain('private-access-token');
  expect(failure.stack).not.toContain('test-secret');
  expect(failure.stack).not.toContain('user:password');
  expect(
    redactDiagnostic(
      'password="private-password" token=private-token sk-1234567890',
    ),
  ).not.toContain('private-');
});

test('processing events survive reopen, preserve attempts, and tolerate an interrupted final write', async () => {
  const runId = crypto.randomUUID();
  try {
    expect(await readProcessingEvents(runId)).toEqual([]);
    await recordProcessingEvent(runId, {
      attempt: 1,
      level: 'info',
      phase: 'Transcribing window 1',
      message: 'Transcribing window 1',
      percent: 5,
    });
    await recordProcessingEvent(runId, {
      attempt: 1,
      level: 'error',
      phase: 'Transcribing window 1',
      message: 'Request failed',
      failure: describeProcessingFailure(
        new Error('token=private-token password="two secret words"'),
      ),
    });
    await recordProcessingEvent(runId, {
      attempt: 2,
      level: 'info',
      phase: 'Retry',
      message: 'Reusing completed window',
      percent: 35,
    });
    await appendFile(
      assetPath(`runs/${runId}/processing.jsonl`),
      '{"interrupted":',
    );
    const events = await readProcessingEvents(runId);
    expect(events.map((event) => event.attempt)).toEqual([1, 1, 2]);
    expect(events[1].phase).toBe('Transcribing window 1');
    expect(JSON.stringify(events)).not.toContain('private-token');
    expect(JSON.stringify(events)).not.toContain('secret words');
    expect(events[1].failure?.message).toContain('password="[redacted]"');
    await recordProcessingEvent(runId, {
      attempt: 3,
      level: 'info',
      phase: 'Resume',
      message: 'Recovered after interrupted log write',
    });
    expect((await readProcessingEvents(runId)).at(-1)?.attempt).toBe(3);
  } finally {
    await rm(assetPath(`runs/${runId}`), { recursive: true, force: true });
  }
});

test('diagnostic paths cannot escape their run directory', async () => {
  await expect(readProcessingEvents('../assets')).rejects.toThrow();
  await expect(
    recordProcessingEvent('../assets', {
      attempt: 1,
      level: 'info',
      phase: 'Source',
      message: 'Source',
    }),
  ).rejects.toThrow();
});

test('recent failures remain observable across the retry delay without polling old failures forever', () => {
  const now = Date.now();
  expect(processingMayResume('failed', new Date(now - 5000), now)).toBe(true);
  expect(processingMayResume('processing', new Date(now - 60000), now)).toBe(
    true,
  );
  expect(processingMayResume('failed', new Date(now - 31000), now)).toBe(false);
  expect(
    processingMayResume('failed', new Date(now - 10 * 60000), now, true),
  ).toBe(true);
  expect(processingMayResume('ready', new Date(now), now)).toBe(false);
});
