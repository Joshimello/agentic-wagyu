import { eq, lte } from 'drizzle-orm';
import { db } from '../db/client';
import {
  memoryNodes,
  memoryNodeVersions,
  revisions,
  uploads,
} from '../db/schema';
import { memorySnapshot } from './memory';
import type {
  OrganizationSnapshot,
  NodeVersion,
} from '../contracts/organization';
import { normalize } from '../contracts/memory';
import { segmentContent } from '../agents/chronicler/organization/source';

export async function organizationSnapshot(
  options: { knownVersion?: number; knownAt?: string } = {},
): Promise<OrganizationSnapshot> {
  const base = await memorySnapshot(options);
  const [nodes, versions] = await Promise.all([
    db
      .select()
      .from(memoryNodes)
      .where(lte(memoryNodes.createdVersion, base.version)),
    db
      .select()
      .from(memoryNodeVersions)
      .where(lte(memoryNodeVersions.commitVersion, base.version)),
  ]);
  return {
    version: base.version,
    nodes,
    versions: versions.map((v) => ({
      ...v.payload,
      commitVersion: v.commitVersion,
    })),
    admissions: base.admissions,
    commits: base.commits,
  };
}
export function reduceOrganization(snapshot: OrganizationSnapshot) {
  const known = snapshot.version;
  const versions = new Map<string, NodeVersion>();
  for (const v of [...snapshot.versions]
    .filter((v) => v.commitVersion <= known)
    .sort((a, b) => a.commitVersion - b.commitVersion))
    versions.set(v.nodeId, v);
  const admission = new Map(
    snapshot.admissions
      .filter((a) => a.commitVersion <= known)
      .map((a) => [a.revisionId, a]),
  );
  const latest = new Map<string, string>();
  for (const a of [...snapshot.admissions]
    .filter((a) => a.commitVersion <= known)
    .sort((a, b) => a.commitVersion - b.commitVersion))
    latest.set(a.uploadId, a.revisionId);
  const all = snapshot.nodes
    .filter((n) => n.createdVersion <= known && versions.has(n.id))
    .map((n) => ({
      ...n,
      current: versions.get(n.id)!,
      history: snapshot.versions
        .filter((v) => v.nodeId === n.id && v.commitVersion <= known)
        .sort((a, b) => b.commitVersion - a.commitVersion),
    }));
  const active = new Set(
    all
      .filter(
        (n) =>
          n.revisionId &&
          admission.has(n.revisionId) &&
          latest.get(admission.get(n.revisionId)!.uploadId) === n.revisionId,
      )
      .map((n) => n.id),
  );
  for (const kind of ['topic', 'project'])
    for (const n of all.filter((n) => n.kind === kind))
      if (n.current.children.some((c) => active.has(c.nodeId)))
        active.add(n.id);
  const nodes = all
    .filter((n) => active.has(n.id))
    .map((n) => ({
      ...n,
      children: n.current.children.filter((c) => active.has(c.nodeId)),
    }));
  return {
    version: known,
    nodes,
    projects: nodes.filter((n) => n.kind === 'project'),
    sources: nodes.filter((n) => n.kind === 'source'),
    topics: nodes.filter((n) => n.kind === 'topic'),
    segments: nodes.filter((n) => n.kind === 'segment'),
    commits: snapshot.commits,
    all,
  };
}
export async function organizationView(
  options: { knownVersion?: number; knownAt?: string } = {},
) {
  const { all, ...view } = reduceOrganization(
    await organizationSnapshot(options),
  );
  return view;
}
export async function openMemoryNode(
  nodeId: string,
  options: { knownVersion?: number; versionId?: string } = {},
) {
  const snapshot = await organizationSnapshot(options),
    reduced = reduceOrganization(snapshot);
  const identity = reduced.all.find((n) => n.id === nodeId);
  if (!identity) throw new Error('Node unavailable in this memory snapshot');
  const current = options.versionId
    ? identity.history.find((v) => v.id === options.versionId)
    : identity.current;
  if (!current) throw new Error('Node version unavailable');
  const children = current.children.map((c) => {
    const node = reduced.all.find((n) => n.id === c.nodeId),
      version = snapshot.versions.find(
        (v) => v.id === c.versionId && v.nodeId === c.nodeId,
      );
    if (!node || !version || version.commitVersion > snapshot.version)
      throw new Error('Invalid historical child reference');
    return {
      id: node.id,
      kind: node.kind,
      versionId: version.id,
      title: version.title,
      summary: version.summary,
      segment: version.segment,
    };
  });
  let source = null;
  if (identity.revisionId) {
    if (!snapshot.admissions.some((a) => a.revisionId === identity.revisionId))
      throw new Error('Source is not admitted');
    const [revision] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, identity.revisionId));
    const [upload] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, revision.uploadId));
    source = {
      revisionId: revision.id,
      uploadId: upload.id,
      filename: upload.filename,
      rawAssetId: revision.manifest.rawAssetId,
      metadata: revision.manifest.metadata,
      coverage: revision.manifest.coverage,
      content: current.segment
        ? segmentContent(
            revision.manifest,
            current.segment.firstUnit,
            current.segment.lastUnit,
          )
        : null,
    };
  }
  const parents = reduced.nodes
    .filter((n) => n.children.some((c) => c.nodeId === nodeId))
    .map((n) => ({ id: n.id, title: n.current.title, kind: n.kind }));
  return {
    version: snapshot.version,
    node: { ...identity, current },
    children,
    parents,
    source,
    archived: !reduced.nodes.some((n) => n.id === nodeId),
  };
}
/** Search both summary nodes and source text. No unpushed revision is loaded. */
export async function searchOrganization(
  query: string,
  options: { knownVersion?: number; projectId?: string; limit?: number } = {},
) {
  const view = await organizationView(options),
    q = normalize(query);
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  if (!q)
    return { version: view.version, hits: [], total: 0, truncated: false };
  const terms = q.split(/\s+/).filter(Boolean);
  let allowed = new Set(view.nodes.map((n) => n.id));
  if (options.projectId) {
    allowed = new Set([options.projectId]);
    for (const kind of ['project', 'topic'])
      for (const node of view.nodes.filter(
        (n) => n.kind === kind && allowed.has(n.id),
      ))
        node.children.forEach((c) => allowed.add(c.nodeId));
  }
  const stages = new Map<string, import('../contracts').Stage>();
  for (const revisionId of new Set(
    view.segments.filter((n) => allowed.has(n.id)).map((n) => n.revisionId!),
  )) {
    const [r] = await db
      .select()
      .from(revisions)
      .where(eq(revisions.id, revisionId));
    stages.set(revisionId, r.manifest);
  }
  const hits = view.nodes
    .filter((n) => allowed.has(n.id))
    .map((n) => {
      const title = normalize(n.current.title),
        summary = normalize(n.current.summary),
        keywords = normalize(n.current.keywords.join(' '));
      const score = terms.reduce(
        (s, t) =>
          s +
          (title.includes(t) ? 5 : 0) +
          (keywords.includes(t) ? 3 : 0) +
          (summary.includes(t) ? 1 : 0),
        0,
      );
      const content = n.current.segment
        ? segmentContent(
            stages.get(n.revisionId!)!,
            n.current.segment.firstUnit,
            n.current.segment.lastUnit,
          ).texts
        : [];
      const matching = content.filter((p) =>
        terms.some((t) => normalize(p.text).includes(t)),
      );
      return {
        nodeId: n.id,
        versionId: n.current.id,
        kind: n.kind,
        title: n.current.title,
        summary: n.current.summary,
        score: score + Math.min(5, matching.length),
        sourceMatched: matching.length > 0,
        matches: matching
          .slice(0, 3)
          .map((p) => ({
            revisionId: n.revisionId,
            primitiveId: p.primitiveId,
            text: p.text,
          })),
        sourceMatchCount: matching.length,
      };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  return {
    version: view.version,
    hits: hits.slice(0, limit),
    total: hits.length,
    truncated: hits.length > limit,
  };
}
