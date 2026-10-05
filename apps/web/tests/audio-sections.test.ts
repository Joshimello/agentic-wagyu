import { expect, test } from 'bun:test';
import {
  audioSections,
  joinAudioSections,
} from '../src/lib/server/agents/interpreter/audio-sections';
const part = (durationMs: number) => ({
  durationMs,
  model: 'MOSS',
  revision: 'pinned',
  truncated: false,
  segments: [{ start: 1, end: 2, speaker: 'S01', text: 'speech' }],
});
test('long audio covers the full container timeline without gaps or duplicate windows', () => {
  const sections = audioSections(3904107);
  expect(sections).toHaveLength(22);
  expect(sections.reduce((n, p) => n + p.durationMs, 0)).toBe(3904107);
  for (let i = 1; i < sections.length; i++)
    expect(sections[i].startMs).toBe(
      sections[i - 1].startMs + sections[i - 1].durationMs,
    );
  for (const duration of [0, -1, Infinity, 1.5])
    expect(() => audioSections(duration)).toThrow();
});
test('section joining offsets timestamps and never equates local speaker IDs', () => {
  const joined = joinAudioSections(181000, [
    part(180000),
    {
      ...part(1000),
      segments: [{ start: 0, end: 0.9, speaker: 'S01', text: 'next' }],
    },
  ]);
  expect(joined.segments[1]).toMatchObject({
    start: 180,
    end: 180.9,
    speaker: 'Part 2 · S01',
  });
  expect(joined.segments[0].speaker).toBe('Part 1 · S01');
  expect(joined.warnings.join(' ')).toContain(
    'matching identities across sections is unverified',
  );
});
test('incomplete or incompatible checkpoints cannot publish a full transcript', () => {
  expect(() => joinAudioSections(181000, [part(180000)])).toThrow();
  expect(() => joinAudioSections(181000, [part(180000), part(2000)])).toThrow();
  expect(() =>
    joinAudioSections(181000, [
      part(180000),
      { ...part(1000), revision: 'changed' },
    ]),
  ).toThrow();
  expect(
    joinAudioSections(181000, [
      part(180000),
      { ...part(1000), truncated: true },
    ]).truncated,
  ).toBe(true);
});
test('local ASR timestamps cannot escape into an adjacent audio section', () => {
  const escaped = {
    ...part(180000),
    segments: [
      { start: 181, end: 182, speaker: 'S01', text: 'outside section' },
    ],
  };
  const joined = joinAudioSections(181000, [
    escaped,
    { ...part(1000), segments: [] },
  ]);
  expect(joined.segments).toEqual([]);
  expect(joined.truncated).toBe(true);
  expect(joined.warnings.join(' ')).toContain(
    'Invalid local ASR intervals were omitted',
  );
});
