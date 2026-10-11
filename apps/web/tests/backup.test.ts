import { test, expect } from 'bun:test';
import { backupManifest } from '../src/lib/server/contracts/backup';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('backup inventory rejects traversal, changed archive names and invalid asset digests', () => {
  const sha256 = 'a'.repeat(64);
  const good = {
    format: 'chronicler-backup-1',
    createdAt: new Date().toISOString(),
    applicationCommit: 'a'.repeat(40),
    database: { file: 'database.dump', sha256, bytes: 1 },
    evidence: { file: 'evidence.tar', sha256, bytes: 10240 },
    assets: [{ storageKey: `assets/aa/${sha256}`, sha256, bytes: 1 }],
    memoryVersion: 0,
    counts: { uploads: 0 },
  };
  expect(backupManifest.safeParse(good).success).toBe(true);
  expect(
    backupManifest.safeParse({
      ...good,
      database: { ...good.database, file: '../private' },
    }).success,
  ).toBe(false);
  expect(
    backupManifest.safeParse({
      ...good,
      assets: [{ ...good.assets[0], storageKey: '../../.env' }],
    }).success,
  ).toBe(false);
  expect(
    backupManifest.safeParse({
      ...good,
      assets: [{ ...good.assets[0], sha256: 'invalid' }],
    }).success,
  ).toBe(false);
  expect(backupManifest.safeParse({ ...good, assets: [] }).success).toBe(true);
});
test('backup verification detects changed archives and missing restored evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chronicler-backup-'));
  const archive = join(root, 'backup'),
    data = join(root, 'data');
  await mkdir(archive);
  await mkdir(data);
  const bytes = new TextEncoder().encode('Durable evidence bytes');
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const storageKey = `assets/${sha256.slice(0, 2)}/${sha256}`;
  await Bun.write(join(data, storageKey), bytes);
  await Bun.write(join(archive, 'database.dump'), 'database');
  await Bun.write(join(archive, 'evidence.tar'), 'archive');
  const digest = async (filename: string) => {
    const file = Bun.file(join(archive, filename));
    return {
      file: filename,
      bytes: file.size,
      sha256: new Bun.CryptoHasher('sha256')
        .update(await file.arrayBuffer())
        .digest('hex'),
    };
  };
  const manifest = {
    format: 'chronicler-backup-1',
    createdAt: new Date().toISOString(),
    applicationCommit: 'a'.repeat(40),
    database: await digest('database.dump'),
    evidence: await digest('evidence.tar'),
    assets: [{ storageKey, sha256, bytes: bytes.length }],
    memoryVersion: 0,
    counts: {},
  };
  await Bun.write(join(archive, 'manifest.json'), JSON.stringify(manifest));
  const verify = async (mode: string) => {
    const child = Bun.spawn(
      ['bun', 'apps/web/tools/backup.ts', mode, archive, data],
      { cwd: '/app', stdout: 'ignore', stderr: 'ignore' },
    );
    return child.exited;
  };
  try {
    expect(await verify('verify-assets')).toBe(0);
    await Bun.write(join(archive, 'database.dump'), 'changed');
    expect(await verify('verify')).not.toBe(0);
    await Bun.write(join(archive, 'database.dump'), 'database');
    await rm(join(data, storageKey));
    expect(await verify('verify-assets')).not.toBe(0);
    await Bun.write(join(data, storageKey), 'different evidence');
    expect(await verify('verify-assets')).not.toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
