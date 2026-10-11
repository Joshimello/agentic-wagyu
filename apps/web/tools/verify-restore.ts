import { sqlClient } from '../src/lib/server/db/client';
const base = process.env.APP_URL ?? 'http://web:5173';
let checks = 0;
async function get(path: string) {
  const response = await fetch(base + path);
  if (!response.ok)
    throw new Error(`Restored reference failed: ${path} (${response.status})`);
  checks++;
  return response;
}
try {
  const assets = await sqlClient`select id from assets`;
  for (const asset of assets) {
    const response = await fetch(base + `/api/assets/${asset.id}`, {
      headers: { Range: 'bytes=0-63' },
    });
    if (!response.ok)
      throw new Error(`Restored asset unavailable: ${asset.id}`);
    await response.body?.cancel();
    checks++;
  }
  const commits =
    await sqlClient`select version from memory_commits order by version`;
  for (const commit of commits) {
    await (
      await get(`/api/memory/organized?knownVersion=${commit.version}`)
    ).body?.cancel();
    await (
      await get(`/api/memory?knownVersion=${commit.version}`)
    ).body?.cancel();
  }
  const citations =
    await sqlClient`select distinct e->>'revisionId' as revision, e->>'primitiveId' as primitive
    from statement_versions, jsonb_array_elements(evidence) e`;
  for (const citation of citations)
    await (
      await get(`/api/evidence/${citation.revision}/${citation.primitive}`)
    ).body?.cancel();
  const nodes =
    await sqlClient`select node_id, commit_version from memory_node_versions`;
  for (const node of nodes)
    await (
      await get(
        `/api/memory/nodes/${node.node_id}?knownVersion=${node.commit_version}`,
      )
    ).body?.cancel();
  const answers =
    await sqlClient`select id,answer from research_runs where state='completed'`;
  let answerCitations = 0;
  for (const answer of answers) {
    const saved = await (await get(`/api/research/${answer.id}`)).json();
    if (JSON.stringify(saved.answer) !== JSON.stringify(answer.answer))
      throw new Error('Saved answer changed on restore');
    await (await get(`/ask/${answer.id}`)).body?.cancel();
    for (const citation of answer.answer.citations) {
      await (await get(citation.url)).body?.cancel();
      answerCitations++;
    }
  }
  if (process.argv.includes('--read-only')) {
    for (const path of ['/api/uploads', '/api/pushes', '/api/research']) {
      const response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.status !== 403)
        throw new Error(`Restored workspace permits writes: ${path}`);
      checks++;
    }
    const html = await (await get('/')).text();
    if (!html.includes('Inspection only'))
      throw new Error('Read-only restore banner missing');
  }
  if (process.argv.includes('--writable')) {
    const [old] =
      await sqlClient`select input->>'question' as question from research_runs where state='completed' and jsonb_array_length(answer->'citations')>0 order by created_at limit 1`;
    if (!old)
      throw new Error(
        'A saved cited question is required for the resume check',
      );
    const [before] =
      await sqlClient`select coalesce(max(version),0)::int as version from memory_commits`;
    const created = await fetch(base + '/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: old.question,
        knownVersion: before.version,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!created.ok)
      throw new Error('Resumed workspace rejected a new question');
    const run = await created.json(),
      deadline = Date.now() + 15 * 60 * 1000;
    let result;
    while (Date.now() < deadline) {
      result = await (await get(`/api/research/${run.id}`)).json();
      if (result.state === 'completed') break;
      if (['failed', 'canceled'].includes(result.state))
        throw new Error('Resumed Researcher failed');
      await Bun.sleep(1000);
    }
    if (result?.state !== 'completed' || !result.answer.citations.length)
      throw new Error('Resumed Researcher did not produce a cited answer');
    for (const citation of result.answer.citations)
      await (await get(citation.url)).body?.cancel();
    const [after] =
      await sqlClient`select coalesce(max(version),0)::int as version from memory_commits`;
    if (before.version !== after.version)
      throw new Error('Research changed restored memory');
    console.log(
      JSON.stringify({
        resumedAnswer: run.id,
        usage: result.usage,
        memoryUnchanged: true,
      }),
    );
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      assets: assets.length,
      commits: commits.length,
      legacyCitations: citations.length,
      nodeVersions: nodes.length,
      savedAnswers: answers.length,
      answerCitations,
    }),
  );
} finally {
  await sqlClient.end();
}
