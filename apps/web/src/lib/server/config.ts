import { resolve } from 'node:path';
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://chronicler:local-only@database:5432/chronicler',
  dataRoot: resolve(process.env.DATA_ROOT ?? '/data'),
  mediaUrl: process.env.MEDIA_URL ?? 'http://media:8000',
  maxUploadBytes: 512 * 1024 * 1024,
};
