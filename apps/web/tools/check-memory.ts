/** Read-only integrity evaluation of a pinned, committed application snapshot. */
const base = process.env.WEB_URL ?? 'http://web:5173';
async function read(path: string): Promise<any> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const current = await read('/api/memory');
const path = `/api/memory?knownVersion=${current.version}`;
const pinned = await read(path);
const references = new Map<
  string,
  { revisionId: string; primitiveId: string; quote: string | null }[]
>();
for (const statement of pinned.statements) {
  if (!pinned.projects.some((p: any) => p.id === statement.projectId))
    throw new Error('Statement project is absent from snapshot');
  for (const version of statement.history) {
    if (!version.evidence.length) throw new Error('Assertion has no evidence');
    if (version.commitVersion > pinned.version)
      throw new Error('Newer knowledge leaked into snapshot');
    for (const evidence of version.evidence) {
      const key = `${evidence.revisionId}/${evidence.primitiveId}`;
      references.set(key, [...(references.get(key) ?? []), evidence]);
    }
  }
}
const entries = [...references];
for (let offset = 0; offset < entries.length; offset += 8) {
  await Promise.all(
    entries.slice(offset, offset + 8).map(async ([key, citations]) => {
      const source = await read(
        `/api/evidence/${key}?knownVersion=${pinned.version}`,
      );
      for (const citation of citations) {
        if (
          source.revisionId !== citation.revisionId ||
          source.primitive.id !== citation.primitiveId
        )
          throw new Error('Citation resolved to different source evidence');
        if (
          citation.quote !== null &&
          (source.primitive.kind !== 'text' ||
            !source.primitive.text.includes(citation.quote))
        )
          throw new Error('Quotation differs from immutable evidence');
      }
    }),
  );
}
for (const project of pinned.projects) {
  const scoped = await read(`${path}&projectId=${project.id}`);
  const ids = new Set(
    scoped.statements.flatMap((s: any) => s.history.map((v: any) => v.id)),
  );
  if (
    scoped.statements.some((s: any) => s.projectId !== project.id) ||
    scoped.relations.some(
      (r: any) => !ids.has(r.fromVersionId) || !ids.has(r.toVersionId),
    )
  )
    throw new Error('Project view contains unrelated assertions/relations');
}
// Concurrent publication may advance Latest, but this recorded snapshot must stay fixed.
const again = await read(path);
if (JSON.stringify(pinned) !== JSON.stringify(again))
  throw new Error('Pinned memory changed during evaluation');
const relationCounts = Object.fromEntries(
  ['support', 'supersede', 'conflict'].map((kind) => [
    kind,
    pinned.relations.filter((r: any) => r.kind === kind).length,
  ]),
);
console.log(
  JSON.stringify({
    accepted: true,
    version: pinned.version,
    projects: pinned.projects.length,
    statements: pinned.statements.length,
    statementVersions: pinned.statements.reduce(
      (n: number, s: any) => n + s.history.length,
      0,
    ),
    uniqueCitations: references.size,
    relationCounts,
  }),
);
export {};
