import { z } from 'zod';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const backupManifest = z
  .object({
    format: z.literal('chronicler-backup-1'),
    createdAt: z.string().datetime(),
    applicationCommit: z.string().regex(/^[a-f0-9]{40}$/),
    database: z.object({
      file: z.literal('database.dump'),
      sha256: digest,
      bytes: z.number().int().positive(),
    }),
    evidence: z.object({
      file: z.literal('evidence.tar'),
      sha256: digest,
      bytes: z.number().int().positive(),
    }),
    assets: z.array(
      z.object({
        storageKey: z.string().regex(/^assets\/[a-f0-9]{2}\/[a-f0-9]{64}$/),
        sha256: digest,
        bytes: z.number().int().positive(),
      }),
    ),
    memoryVersion: z.number().int().nonnegative(),
    counts: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
