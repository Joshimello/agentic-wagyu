import { afterAll, beforeEach, expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const enabled = process.env.TEST_SUITE === 'migrations';
if (
  enabled &&
  !new URL(process.env.DATABASE_URL!).pathname.startsWith(
    '/chronicler_migration_test_',
  )
)
  throw new Error(
    'Migration upgrades require a disposable migration-test database',
  );
const check = test.skipIf(!enabled);
const sql = enabled
  ? postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  : null;
const folder = new URL('../drizzle/', import.meta.url).pathname;
const temporary: string[] = [];
beforeEach(async () => {
  if (!sql) return;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
});
afterAll(async () => {
  await sql?.end();
  await Promise.all(
    temporary.map((path) => rm(path, { recursive: true, force: true })),
  );
});

type LegacyBranch =
  | 'research'
  | 'translation'
  | 'local-control'
  | 'local-activity'
  | 'upstream-release';
async function legacyFolder(branch: LegacyBranch) {
  const path = await mkdtemp(join(tmpdir(), 'chronicler-migrations-'));
  temporary.push(path);
  await mkdir(join(path, 'meta'));
  const journal = JSON.parse(
    await readFile(join(folder, 'meta/_journal.json'), 'utf8'),
  );
  if (branch.startsWith('local-') || branch === 'upstream-release') {
    const saved = JSON.parse(
      await readFile(
        new URL(
          `./fixtures/migrations/${branch === 'upstream-release' ? 'upstream-release' : 'local-workspace'}-journal.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
    journal.entries =
      branch === 'local-control' ? saved.entries.slice(0, -1) : saved.entries;
  } else
    journal.entries = journal.entries.slice(0, branch === 'research' ? 7 : 5);
  for (const entry of journal.entries)
    await copyFile(
      join(folder, `${entry.tag}.sql`),
      join(path, `${entry.tag}.sql`),
    );
  if (branch === 'translation') {
    // The independently shipped remote history, before the merge. Keep this
    // immutable fixture independent of the forward migration being tested.
    journal.entries.push({
      idx: 5,
      version: '7',
      when: 1791707788156,
      tag: '0005_transcript_translations',
      breakpoints: true,
    });
    await copyFile(
      new URL(
        './fixtures/migrations/transcript-translations.sql',
        import.meta.url,
      ),
      join(path, '0005_transcript_translations.sql'),
    );
  }
  await writeFile(join(path, 'meta/_journal.json'), JSON.stringify(journal));
  return path;
}

async function seedEvidence() {
  const asset = crypto.randomUUID(),
    upload = crypto.randomUUID(),
    revision = crypto.randomUUID();
  await sql!`INSERT INTO assets (id,sha256,storage_key,mime,bytes) VALUES (${asset},${asset},'preserved','text/plain',10)`;
  await sql!`INSERT INTO uploads (id,asset_id,filename,metadata) VALUES (${upload},${asset},'preserved.txt','{}')`;
  await sql!`INSERT INTO staging_revisions (id,upload_id,manifest) VALUES (${revision},${upload},'{}')`;
  await sql!`INSERT INTO memory_commits (id,version) VALUES (${crypto.randomUUID()},1)`;
  return revision;
}

async function assertCombinedSchema() {
  const columns =
    await sql!`SELECT table_name,count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('research_runs','research_outbox','transcript_translations','translation_outbox') GROUP BY table_name ORDER BY table_name`;
  expect(columns.map((r) => [r.table_name, r.n])).toEqual([
    ['research_outbox', 4],
    ['research_runs', 15],
    ['transcript_translations', 16],
    ['translation_outbox', 3],
  ]);
  const constraints =
    await sql!`SELECT conname FROM pg_constraint WHERE conname IN ('research_outbox_id_research_runs_id_fk','transcript_translations_revision_id_staging_revisions_id_fk','translation_outbox_id_transcript_translations_id_fk')`;
  expect(constraints).toHaveLength(3);
  const [index] =
    await sql!`SELECT indexdef FROM pg_indexes WHERE indexname='transcript_translation_revision_language_prompt_unique'`;
  expect(index.indexdef).toContain('UNIQUE');
  const [generation] =
    await sql!`SELECT column_default,is_nullable FROM information_schema.columns WHERE table_name='research_outbox' AND column_name='generation'`;
  expect(generation).toMatchObject({ column_default: '0', is_nullable: 'NO' });
  const extra =
    await sql!`SELECT table_name,count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('meeting_summaries','summary_outbox','upload_sessions','model_requests') GROUP BY table_name ORDER BY table_name`;
  expect(extra.map((row) => [row.table_name, row.n])).toEqual([
    ['meeting_summaries', 12],
    ['model_requests', 13],
    ['summary_outbox', 3],
    ['upload_sessions', 6],
  ]);
  const progress =
    await sql!`SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND ((table_name IN ('interpretation_runs','push_batches') AND column_name='progress_percent') OR (table_name IN ('push_batches','chronicler_outbox') AND column_name='generation') OR (table_name='uploads' AND column_name='deleted_at'))`;
  expect(progress).toHaveLength(5);
}

for (const branch of ['research', 'translation'] as const)
  check(
    `upgrade from independently applied ${branch} history preserves records and converges`,
    async () => {
      await migrate(drizzle(sql!), {
        migrationsFolder: await legacyFolder(branch),
      });
      const revision = await seedEvidence(),
        id = crypto.randomUUID();
      if (branch === 'research') {
        await sql!`INSERT INTO research_runs (id,idempotency_key,input,scope,state,answer) VALUES (${id},${id},'{}','{"version":1}','completed','{"preserved":true}')`;
        await sql!`INSERT INTO research_outbox (id,generation) VALUES (${id},3)`;
      } else {
        await sql!`INSERT INTO transcript_translations (id,revision_id,language,prompt_version,fingerprint,state,total_segments,translations) VALUES (${id},${revision},'en','translation-1','original','completed',1,'[{"preserved":true}]')`;
        await sql!`INSERT INTO translation_outbox (id) VALUES (${id})`;
      }
      const before =
        await sql!`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
      await migrate(drizzle(sql!), { migrationsFolder: folder });
      await assertCombinedSchema();
      expect([
        ...(await sql!`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT ${before.length}`),
      ]).toEqual([...before]);
      expect([...(await sql!`SELECT filename FROM uploads`)]).toEqual([
        { filename: 'preserved.txt' },
      ]);
      expect([...(await sql!`SELECT version FROM memory_commits`)]).toEqual([
        { version: 1 },
      ]);
      if (branch === 'research') {
        expect(
          (await sql!`SELECT answer FROM research_runs WHERE id=${id}`)[0]
            .answer,
        ).toEqual({ preserved: true });
        expect(
          (await sql!`SELECT generation FROM research_outbox WHERE id=${id}`)[0]
            .generation,
        ).toBe(3);
      } else {
        expect(
          (
            await sql!`SELECT translations FROM transcript_translations WHERE id=${id}`
          )[0].translations,
        ).toEqual([{ preserved: true }]);
        expect([
          ...(await sql!`SELECT id FROM translation_outbox WHERE id=${id}`),
        ]).toHaveLength(1);
      }
      const after =
        await sql!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
      await migrate(drizzle(sql!), { migrationsFolder: folder });
      expect([
        ...(await sql!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`),
      ]).toEqual([...after]);
    },
    30000,
  );

for (const branch of [
  'local-control',
  'local-activity',
  'upstream-release',
] as const)
  check(
    `upgrade from ${branch} preserves evidence, cached work and applied migration hashes`,
    async () => {
      await migrate(drizzle(sql!), {
        migrationsFolder: await legacyFolder(branch),
      });
      const revision = await seedEvidence(),
        id = crypto.randomUUID();
      await sql!`INSERT INTO transcript_translations (id,revision_id,language,prompt_version,fingerprint,state,total_segments,translations) VALUES (${id},${revision},'en','translation-1','original','ready',1,'[{"preserved":true}]')`;
      await sql!`INSERT INTO translation_outbox (id) VALUES (${id})`;
      if (branch === 'local-activity') {
        await sql!`INSERT INTO meeting_summaries (id,revision_id,prompt_version,state,summary) VALUES (${id},${revision},'summary-1','ready','{"preserved":true}')`;
        await sql!`INSERT INTO summary_outbox (id) VALUES (${id})`;
      }
      if (branch === 'upstream-release') {
        await sql!`INSERT INTO research_runs (id,idempotency_key,input,scope,state,answer) VALUES (${id},${id},'{}','{"version":1}','completed','{"preserved":true}')`;
        await sql!`INSERT INTO research_outbox (id,generation) VALUES (${id},3)`;
      }
      const before =
        await sql!`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
      await migrate(drizzle(sql!), { migrationsFolder: folder });
      await assertCombinedSchema();
      expect([
        ...(await sql!`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT ${before.length}`),
      ]).toEqual([...before]);
      expect(
        (
          await sql!`SELECT translations FROM transcript_translations WHERE id=${id}`
        )[0].translations,
      ).toEqual([{ preserved: true }]);
      expect((await sql!`SELECT version FROM memory_commits`)[0].version).toBe(
        1,
      );
      expect((await sql!`SELECT filename FROM uploads`)[0].filename).toBe(
        'preserved.txt',
      );
      if (branch === 'local-activity')
        expect(
          (await sql!`SELECT summary FROM meeting_summaries WHERE id=${id}`)[0]
            .summary,
        ).toEqual({ preserved: true });
      if (branch === 'upstream-release') {
        expect(
          (await sql!`SELECT answer FROM research_runs WHERE id=${id}`)[0]
            .answer,
        ).toEqual({ preserved: true });
        expect(
          (await sql!`SELECT generation FROM research_outbox WHERE id=${id}`)[0]
            .generation,
        ).toBe(3);
      }
      const after =
        await sql!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
      await migrate(drizzle(sql!), { migrationsFolder: folder });
      expect([
        ...(await sql!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`),
      ]).toEqual([...after]);
    },
    30000,
  );

check(
  'fresh installs and repeated migration runs produce the combined schema',
  async () => {
    await migrate(drizzle(sql!), { migrationsFolder: folder });
    await assertCombinedSchema();
    const before =
      await sql!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
    await migrate(drizzle(sql!), { migrationsFolder: folder });
    expect([
      ...(await sql!`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`),
    ]).toEqual([...before]);
  },
  30000,
);
