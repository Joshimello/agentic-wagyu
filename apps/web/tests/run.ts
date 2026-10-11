import { readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const mode = process.argv[2] ?? 'unit';
const directory = new URL('.', import.meta.url).pathname;
async function run(command: string[], env: Record<string, string | undefined>) {
  const process = Bun.spawn(command, {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const status = await process.exited;
  if (status !== 0) throw new Error(`${command.join(' ')} exited ${status}`);
}
const env = {
  ...process.env,
  OPENAI_API_KEY: '',
  OPENAI_MODEL: '',
  OPENAI_BASE_URL: '',
  TEST_SUITE: '',
};
if (mode === 'unit') {
  const files = (await readdir(directory))
    .filter(
      (name) =>
        name.endsWith('.test.ts') && !name.endsWith('.integration.test.ts'),
    )
    .sort();
  await run(
    ['bun', 'test', ...files.map((name) => join(directory, name))],
    env,
  );
} else if (mode === 'integration') {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'Set TEST_DATABASE_URL to a disposable test PostgreSQL server; use infra/test.sh integration.',
    );
  const admin = postgres(process.env.TEST_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  const suites = [
    'staging',
    'memory',
    'organization',
    'research',
    'operations',
    'translations',
    'migrations',
  ];
  if (process.argv.includes('--documents')) suites.push('documents');
  const selected = process.argv
    .find((arg) => arg.startsWith('--suite='))
    ?.slice(8);
  if (selected && ![...suites, 'documents'].includes(selected))
    throw new Error('Unknown integration suite');
  try {
    await mkdir('/data/tests', { recursive: true });
    for (const suite of selected ? [selected] : suites) {
      const prefix =
        suite === 'translations'
          ? 'translation'
          : suite === 'migrations'
            ? 'migration'
            : suite;
      const name = `chronicler_${prefix}_test_${crypto.randomUUID().replaceAll('-', '')}`;
      const data = await mkdtemp('/data/tests/suite-');
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.pathname = '/' + name;
      try {
        await admin.unsafe(`CREATE DATABASE ${name}`);
        const suiteEnv = {
          ...env,
          DATABASE_URL: url.href,
          DATA_ROOT: suite === 'documents' ? '/data' : data,
          TEST_SUITE: suite,
        };
        if (suite !== 'migrations')
          await run(['bun', 'apps/web/src/lib/server/db/migrate.ts'], suiteEnv);
        await run(
          ['bun', 'test', join(directory, `${suite}.integration.test.ts`)],
          suiteEnv,
        );
      } finally {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await rm(data, { recursive: true, force: true });
      }
    }
  } finally {
    await admin.end();
  }
} else throw new Error('Use unit or integration');
