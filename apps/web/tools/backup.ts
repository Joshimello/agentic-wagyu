import { join } from 'node:path';
import { backupManifest } from '../src/lib/server/contracts/backup';

const [mode, directory = '/backup', dataRoot = '/data'] = process.argv.slice(2);
async function checksum(path: string) {
  const file = Bun.file(path),
    hash = new Bun.CryptoHasher('sha256');
  for await (const chunk of file.stream()) hash.update(chunk);
  return { sha256: hash.digest('hex'), bytes: file.size };
}
async function verifyAssets(
  assets: { storageKey: string; sha256: string; bytes: number }[],
) {
  for (const asset of assets) {
    const actual = await checksum(join(dataRoot, asset.storageKey));
    if (actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes)
      throw new Error(`Evidence checksum mismatch: ${asset.storageKey}`);
  }
}
if (mode === 'create') {
  const { sqlClient } = await import('../src/lib/server/db/client');
  try {
    const assets =
      await sqlClient`select storage_key as "storageKey",sha256,bytes::float8 from assets order by storage_key`;
    await verifyAssets(
      assets as unknown as {
        storageKey: string;
        sha256: string;
        bytes: number;
      }[],
    );
    const counts: Record<string, number> = {};
    for (const table of [
      'assets',
      'uploads',
      'staging_revisions',
      'memory_commits',
      'knowledge_events',
      'memory_nodes',
      'memory_node_versions',
      'statements',
      'statement_versions',
      'research_runs',
      'transcript_translations',
      'model_requests',
    ]) {
      const [row] =
        await sqlClient`select count(*)::int as count from ${sqlClient(table)}`;
      counts[table] = row.count;
    }
    const [memory] =
      await sqlClient`select coalesce(max(version),0)::int as version from memory_commits`;
    const manifest = backupManifest.parse({
      format: 'chronicler-backup-1',
      createdAt: new Date().toISOString(),
      applicationCommit: process.env.APPLICATION_COMMIT,
      database: {
        file: 'database.dump',
        ...(await checksum(join(directory, 'database.dump'))),
      },
      evidence: {
        file: 'evidence.tar',
        ...(await checksum(join(directory, 'evidence.tar'))),
      },
      assets,
      memoryVersion: memory.version,
      counts,
    });
    await Bun.write(
      join(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    console.log(
      JSON.stringify({
        backup: directory,
        assets: assets.length,
        memoryVersion: memory.version,
        bytes: manifest.database.bytes + manifest.evidence.bytes,
      }),
    );
  } finally {
    await sqlClient.end();
  }
} else if (['verify', 'verify-assets', 'verify-database'].includes(mode)) {
  const manifest = backupManifest.parse(
    await Bun.file(join(directory, 'manifest.json')).json(),
  );
  for (const entry of [manifest.database, manifest.evidence]) {
    const actual = await checksum(join(directory, entry.file));
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes)
      throw new Error(`Backup checksum mismatch: ${entry.file}`);
  }
  if (mode !== 'verify') await verifyAssets(manifest.assets);
  if (mode === 'verify-database') {
    const { sqlClient } = await import('../src/lib/server/db/client');
    try {
      const restored =
        await sqlClient`select storage_key as "storageKey",sha256,bytes::float8 from assets order by storage_key`;
      if (JSON.stringify(restored) !== JSON.stringify(manifest.assets))
        throw new Error(
          'Restored database evidence inventory differs from backup',
        );
      for (const [table, count] of Object.entries(manifest.counts)) {
        if (!/^[a-z_]+$/.test(table))
          throw new Error('Invalid inventory table');
        const [row] =
          await sqlClient`select count(*)::int as count from ${sqlClient(table)}`;
        if (row.count !== count)
          throw new Error(`Restored record count differs: ${table}`);
      }
      const [memory] =
        await sqlClient`select coalesce(max(version),0)::int as version from memory_commits`;
      if (memory.version !== manifest.memoryVersion)
        throw new Error('Restored memory version differs');
    } finally {
      await sqlClient.end();
    }
  }
  console.log(
    JSON.stringify({
      verified: true,
      assets: manifest.assets.length,
      memoryVersion: manifest.memoryVersion,
    }),
  );
} else throw new Error('Choose create, verify or verify-assets');
