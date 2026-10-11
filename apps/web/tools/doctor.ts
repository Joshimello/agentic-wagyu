import { sqlClient } from '../src/lib/server/db/client';
import { llmClient } from '../src/lib/server/llm/client';
import { withOperation } from '../src/lib/server/jobs/operation';
import { usageLimits } from '../src/lib/server/llm/usage';
try {
  const [schema] =
    await sqlClient`select to_regclass('public.model_requests') as usage, to_regclass('public.memory_node_versions') as memory`;
  if (!schema.usage || !schema.memory)
    throw new Error('Apply database migrations before starting workers');
  console.log('Database and application schema: ready');
  const web = await fetch('http://web:5173/api/health');
  if (!web.ok) throw new Error('Web health check failed');
  console.log('Web: ready');
  const media = await fetch('http://media:8000/health');
  if (!media.ok || !(await media.json()).ok)
    throw new Error('Media health check failed');
  console.log('Media: ready');
  const { client, model } = llmClient();
  console.log('Model configuration: present');
  console.log(JSON.stringify({ usageLimits: usageLimits() }));
  if (process.argv.includes('--live')) {
    await withOperation(
      { kind: 'configuration-check', id: crypto.randomUUID() },
      () =>
        client.chat.completions.create({
          model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        }),
    );
    console.log('Model connection: ready (live request completed)');
  }
} catch (error) {
  // Never print SDK request objects, headers, response bodies or credentials.
  console.error(
    error instanceof Error && !('status' in error)
      ? error.message
      : 'Model connection failed; check private configuration',
  );
  process.exitCode = 1;
} finally {
  await sqlClient.end();
}
