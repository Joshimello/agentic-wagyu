import {
  organizationPlan,
  validatePartition,
  type OrganizationPlan,
  type MemoryNode,
  type NodeVersion,
} from '../../../contracts/organization';
import type { Stage } from '../../../contracts';
import { sourceUnits } from './source';

/** Validate immutable references and full source coverage before the publication transaction writes anything. */
export function validateOrganization(
  proposal: OrganizationPlan,
  existingNodes: MemoryNode[],
  existingVersions: NodeVersion[],
  stages: Stage[],
  activeRevisionIds: Set<string>,
) {
  organizationPlan.parse(proposal);
  const nodes = new Map(existingNodes.map((n) => [n.id, n]));
  const versions = new Map(existingVersions.map((v) => [v.id, v]));
  const latest = new Map<string, string>();
  for (const v of [...existingVersions].sort(
    (a, b) => a.commitVersion - b.commitVersion,
  ))
    latest.set(v.nodeId, v.id);
  for (const n of proposal.nodes) {
    if (nodes.has(n.id))
      throw new Error('Cannot overwrite memory node identity');
    nodes.set(n.id, { ...n, createdVersion: 0 });
  }
  const changed = new Set<string>();
  for (const v of proposal.versions) {
    if (versions.has(v.id) || changed.has(v.nodeId))
      throw new Error('Cannot overwrite or duplicate memory history');
    if (!nodes.has(v.nodeId)) throw new Error('Missing node identity');
    changed.add(v.nodeId);
    versions.set(v.id, { ...v, commitVersion: 0 });
    latest.set(v.nodeId, v.id);
  }
  const sourceParents = new Map<string, number>(),
    topicParents = new Map<string, number>();
  for (const v of proposal.versions) {
    const n = nodes.get(v.nodeId)!;
    if (new Set(v.children.map((c) => c.nodeId)).size !== v.children.length)
      throw new Error('Duplicate child');
    if ((n.kind === 'project' || n.kind === 'topic') && n.revisionId !== null)
      throw new Error('Scope cannot own a source revision');
    if (n.kind === 'project' && n.scopeId !== null)
      throw new Error('Project cannot be nested');
    if (n.kind === 'topic' && nodes.get(n.scopeId ?? '')?.kind !== 'project')
      throw new Error('Topic requires project scope');
    if (
      n.kind === 'source' &&
      (n.scopeId !== null || !stages.some((s) => s.id === n.revisionId))
    )
      throw new Error('Source requires selected pinned revision');
    if (n.kind === 'segment') {
      const source = nodes.get(n.scopeId ?? '');
      const stage = stages.find((s) => s.id === n.revisionId);
      if (
        !source ||
        source.kind !== 'source' ||
        source.revisionId !== n.revisionId ||
        !stage ||
        !v.segment ||
        v.segment.revisionId !== n.revisionId ||
        v.children.length
      )
        throw new Error('Invalid source segment');
      const units = sourceUnits(stage);
      if (
        v.segment.firstUnit > v.segment.lastUnit ||
        v.segment.lastUnit >= units.length
      )
        throw new Error('Segment outside source');
    } else if (v.segment)
      throw new Error('Only segments may have source ranges');
    for (const child of v.children) {
      const cn = nodes.get(child.nodeId),
        cv = versions.get(child.versionId);
      if (!cn || !cv || cv.nodeId !== cn.id || latest.get(cn.id) !== cv.id)
        throw new Error('Child must pin the current version at publication');
      if (n.kind === 'project' && (cn.kind !== 'topic' || cn.scopeId !== n.id))
        throw new Error('Cross-project topic reference');
      if (n.kind === 'topic') {
        if (cn.kind !== 'segment' || !activeRevisionIds.has(cn.revisionId!))
          throw new Error('Topic requires active admitted source segments');
        topicParents.set(cn.id, (topicParents.get(cn.id) ?? 0) + 1);
      }
      if (n.kind === 'source') {
        if (
          cn.kind !== 'segment' ||
          cn.scopeId !== n.id ||
          cn.revisionId !== n.revisionId
        )
          throw new Error('Cross-source segment reference');
        sourceParents.set(cn.id, (sourceParents.get(cn.id) ?? 0) + 1);
      }
    }
    if (n.kind === 'source')
      validatePartition(
        v.children.map((c) => versions.get(c.versionId)!.segment!),
        0,
        sourceUnits(stages.find((s) => s.id === n.revisionId)!).length - 1,
      );
  }
  for (const n of proposal.nodes) {
    if (!changed.has(n.id)) throw new Error('Unversioned new node');
    if (n.kind === 'segment' && sourceParents.get(n.id) !== 1)
      throw new Error('Segment requires exactly one source parent');
  }
  if ([...topicParents.values()].some((count) => count > 1))
    throw new Error('Segment belongs to multiple primary topics');
}
