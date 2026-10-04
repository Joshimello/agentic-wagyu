import { mkdir, link, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { config } from '../config';
export function assetPath(key: string) {
  const result = resolve(config.dataRoot, key);
  if (!result.startsWith(config.dataRoot + sep))
    throw new Error('Invalid storage path');
  return result;
}
export async function storeBytes(bytes: Uint8Array) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = `assets/${sha256.slice(0, 2)}/${sha256}`;
  const dest = assetPath(storageKey);
  await mkdir(join(dest, '..'), { recursive: true });
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  await Bun.write(tmp, bytes);
  try {
    await link(tmp, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  } finally {
    await unlink(tmp);
  }
  return { sha256, storageKey, bytes: bytes.length };
}
