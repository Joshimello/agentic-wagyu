import { expect, test } from 'bun:test';
import { config } from '../src/lib/server/config';
import { describeProcessingFailure } from '../src/lib/server/agents/interpreter/diagnostics';
import {
  mediaRequest,
  MediaRequestError,
} from '../src/lib/server/agents/interpreter/media-client';

test('quiet local media requests complete within their explicit inference deadline', async () => {
  const base = config.mediaUrl,
    budget = config.mediaTranscriptionTimeoutMs;
  const server = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(80);
      return Response.json({ completed: true });
    },
  });
  config.mediaUrl = server.url.toString().replace(/\/$/, '');
  config.mediaTranscriptionTimeoutMs = 1000;
  try {
    expect(await mediaRequest('transcribe', {})).toEqual({ completed: true });
  } finally {
    config.mediaUrl = base;
    config.mediaTranscriptionTimeoutMs = budget;
    await server.stop(true);
  }
});

test('a slow media response has an actionable deadline failure while explicit cancellation stays cancellation', async () => {
  const base = config.mediaUrl,
    budget = config.mediaTranscriptionTimeoutMs;
  const server = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(200);
      return Response.json({ completed: true });
    },
  });
  config.mediaUrl = server.url.toString().replace(/\/$/, '');
  config.mediaTranscriptionTimeoutMs = 20;
  try {
    try {
      await mediaRequest('transcribe', {});
      throw new Error('Expected deadline failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MediaRequestError);
      expect(error).toMatchObject({
        route: 'transcribe',
        code: 'media_timeout',
        retryable: true,
      });
    }
    const controller = new AbortController();
    controller.abort(new Error('User canceled this recording'));
    await expect(
      mediaRequest('transcribe', {}, controller.signal),
    ).rejects.toThrow('User canceled this recording');
  } finally {
    config.mediaUrl = base;
    config.mediaTranscriptionTimeoutMs = budget;
    await server.stop(true);
  }
});

test('invalid source responses do not qualify for automatic retries', async () => {
  const base = config.mediaUrl;
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json(
        { detail: 'Audio section is outside the recording' },
        { status: 422 },
      );
    },
  });
  config.mediaUrl = server.url.toString().replace(/\/$/, '');
  try {
    try {
      await mediaRequest('transcribe', {});
      throw new Error('Expected invalid source failure');
    } catch (error) {
      expect(error).toMatchObject({
        status: 422,
        retryable: false,
        message: 'Audio section is outside the recording',
      });
    }
  } finally {
    config.mediaUrl = base;
    await server.stop(true);
  }
});

test('a transient canceled media control remains retryable while explicit user cancellation wins', async () => {
  const base = config.mediaUrl;
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ detail: 'Processing cancelled' }, { status: 409 });
    },
  });
  config.mediaUrl = server.url.toString().replace(/\/$/, '');
  try {
    try {
      await mediaRequest('transcribe', {});
      throw new Error('Expected temporarily canceled control');
    } catch (error) {
      expect(error).toMatchObject({ status: 409, retryable: true });
    }
  } finally {
    config.mediaUrl = base;
    await server.stop(true);
  }
});

test('media engine failures retain the remote exception and traceback without exposing its credentials', async () => {
  const base = config.mediaUrl;
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json(
        {
          detail: {
            message: 'Transcription failed',
            failure: {
              type: 'OutOfMemoryError',
              message: 'GPU allocation failed token=private-token',
              stack:
                'asr.py: model.generate\nOutOfMemoryError: GPU allocation failed token=private-token',
            },
          },
        },
        { status: 500 },
      );
    },
  });
  config.mediaUrl = server.url.toString().replace(/\/$/, '');
  try {
    try {
      await mediaRequest('transcribe', {});
      throw new Error('Expected model failure');
    } catch (error) {
      const failure = describeProcessingFailure(error);
      expect(failure).toMatchObject({
        status: 500,
        retryable: true,
        code: 'media_response',
      });
      expect(failure.message).toContain('OutOfMemoryError');
      expect(failure.stack).toContain('asr.py: model.generate');
      expect(failure.stack).not.toContain('private-token');
    }
  } finally {
    config.mediaUrl = base;
    await server.stop(true);
  }
});
