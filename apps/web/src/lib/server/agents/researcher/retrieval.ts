import type { Stage } from '../../contracts';
import type {
  OrganizationSnapshot,
  NodeVersion,
} from '../../contracts/organization';
import type {
  Citation,
  ResearchScope,
  ResearchAnswer,
  AnswerProposal,
} from '../../contracts/research';
import { researchLimits } from '../../contracts/research';
import { reduceOrganization } from '../../services/organization';
import { segmentContent } from '../chronicler/organization/source';
import { stableId } from '../../contracts/memory';
import { traditionalChinese } from '../../text-normalization';

const normalize = (s: string) =>
  traditionalChinese(s).normalize('NFKC').toLowerCase();
export function queryTerms(query: string) {
  const normalized = normalize(query);
  const words =
    normalized.match(/[a-z0-9][a-z0-9_+.-]*|[\p{Script=Han}]+/gu) ?? [];
  const stop = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'of',
    'to',
    'in',
    'is',
    'was',
    'what',
    'which',
    'how',
    'did',
    'does',
    'for',
    'on',
    'with',
    'this',
    'that',
    'are',
    'were',
    'across',
    'from',
  ]);
  return [
    ...new Set(
      words.flatMap((w) =>
        /\p{Script=Han}/u.test(w) && w.length > 2
          ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))
          : stop.has(w)
            ? []
            : [w],
      ),
    ),
  ].slice(0, 32);
}
export type CorpusData = {
  snapshot: OrganizationSnapshot;
  stages: Map<string, { stage: Stage; filename: string }>;
};
/** Everything an agent can see comes from this frozen, application-scoped corpus. No writes or latest-staging lookups. */
export class ResearchCorpus {
  readonly view;
  readonly allowed = new Set<string>();
  readonly active = new Set<string>();
  readonly evidence = new Map<string, Citation>();
  readonly inspected = new Set<string>();
  readonly warnings = new Set<string>();
  private textCharacters = 0;
  constructor(
    readonly data: CorpusData,
    readonly scope: ResearchScope,
  ) {
    this.view = reduceOrganization(data.snapshot);
    if (scope.version !== data.snapshot.version)
      throw new Error('Snapshot mismatch');
    const root = scope.projectId
      ? this.view.projects.find((n) => n.id === scope.projectId)
      : null;
    if (scope.projectId && !root)
      throw new Error('Project unavailable in this snapshot');
    const walk = (nodeId: string, historical: boolean) => {
      const set = historical ? this.allowed : this.active;
      if (set.has(nodeId)) return;
      set.add(nodeId);
      const n = this.view.all.find((n) => n.id === nodeId);
      if (!n) return;
      for (const v of historical ? n.history : [n.current])
        for (const c of v.children) walk(c.nodeId, historical);
    };
    if (root) {
      walk(root.id, false);
      walk(root.id, true);
    } else {
      this.view.nodes.forEach((n) => this.active.add(n.id));
      this.view.all.forEach((n) => this.allowed.add(n.id));
    }
    for (const n of this.view.all.filter((n) => n.kind === 'segment')) {
      if (this.active.has(n.id) && n.scopeId) this.active.add(n.scopeId);
      if (this.allowed.has(n.id) && n.scopeId) this.allowed.add(n.scopeId);
    }
    for (const n of this.view.all)
      if (n.revisionId && !this.eligible(n.revisionId)) {
        this.active.delete(n.id);
        this.allowed.delete(n.id);
      }
    if (scope.effectiveAt)
      this.warnings.add(
        'Event-date filter excludes unknown dates. File-derived dates are tentative; filenames are not confirmed event dates. Overview prose is hidden to prevent date-filter leakage.',
      );
    this.warnings.add(
      'Retrieval uses multilingual lexical ranking over summaries and original text, plus hierarchy traversal. No embedding service is configured; paraphrases may require additional searches.',
    );
  }
  private eligible(revisionId: string) {
    if (
      !this.data.snapshot.admissions.some(
        (a) =>
          a.revisionId === revisionId && a.commitVersion <= this.scope.version,
      )
    )
      return false;
    const stage = this.data.stages.get(revisionId)?.stage;
    if (!stage) return false;
    return (
      !this.scope.effectiveAt ||
      (!!stage.metadata.sourceTime &&
        stage.metadata.sourceTime.slice(0, 10) <= this.scope.effectiveAt)
    );
  }
  private node(id: string, historical = false, versionId?: string) {
    if (!(historical ? this.allowed : this.active).has(id))
      throw new Error('Node outside query scope');
    const n = this.view.all.find((n) => n.id === id);
    if (!n) throw new Error('Unknown node');
    const v = versionId ? n.history.find((v) => v.id === versionId) : n.current;
    if (!v || v.commitVersion > this.scope.version)
      throw new Error('Version outside snapshot');
    return { n, v };
  }
  private overview(n: (typeof this.view.all)[number], v = n.current) {
    return {
      nodeId: n.id,
      versionId: v.id,
      kind: n.kind,
      title: v.title,
      summary:
        this.scope.effectiveAt && !v.segment
          ? 'Date-filtered overview: inspect eligible child segments.'
          : v.summary,
      warnings: v.warnings,
      recordedVersion: v.commitVersion,
      source: n.revisionId
        ? this.data.stages.get(n.revisionId)?.filename
        : null,
      eventDate: n.revisionId
        ? this.data.stages.get(n.revisionId)?.stage.metadata.sourceTime
        : null,
      dateOrigin: n.revisionId
        ? this.data.stages.get(n.revisionId)?.stage.metadata.sourceTimeOrigin
        : null,
    };
  }
  catalog(offset = 0) {
    const nodes = this.view.nodes.filter(
      (n) => this.active.has(n.id) && ['project', 'source'].includes(n.kind),
    );
    return {
      snapshot: this.scope,
      total: nodes.length,
      offset,
      truncated: nodes.length > offset + 20,
      nodes: nodes.slice(offset, offset + 20).map((n) => this.overview(n)),
      warnings: [...this.warnings],
    };
  }
  search(query: string, limit = 10, fragmentsOnly = false) {
    const terms = queryTerms(query);
    const nodes = this.view.nodes.filter(
      (n) => this.active.has(n.id) && (!fragmentsOnly || n.kind === 'segment'),
    );
    const docs = nodes.map((n) => {
      const content = n.current.segment
        ? segmentContent(
            this.data.stages.get(n.revisionId!)!.stage,
            n.current.segment.firstUnit,
            n.current.segment.lastUnit,
          )
        : null;
      return {
        n,
        overview: normalize(
          `${n.current.title} ${this.scope.effectiveAt && !content ? '' : n.current.summary} ${n.current.keywords.join(' ')}`,
        ),
        source: normalize(content?.texts.map((t) => t.text).join('\n') ?? ''),
      };
    });
    const rank = (channel: 'overview' | 'source') =>
      docs
        .map((d) => ({
          id: d.n.id,
          score: terms.reduce((sum, term) => {
            const count = docs.filter((x) => x[channel].includes(term)).length;
            return (
              sum +
              (d[channel].includes(term)
                ? Math.log(1 + docs.length / (1 + count)) *
                  (term.length > 2 ? 1.5 : 1)
                : 0)
            );
          }, 0),
        }))
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const scores = new Map<string, number>();
    for (const channel of fragmentsOnly
      ? (['source'] as const)
      : (['overview', 'source'] as const))
      rank(channel).forEach((d, i) =>
        scores.set(d.id, (scores.get(d.id) ?? 0) + 1 / (30 + i)),
      );
    const ranked = [...scores].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    return {
      total: ranked.length,
      truncated: ranked.length > limit,
      hits: ranked.slice(0, Math.min(limit, 20)).map(([id, score]) => {
        const d = docs.find((d) => d.n.id === id)!;
        return {
          ...this.overview(d.n),
          score,
          sourceMatched: terms.some((t) => d.source.includes(t)),
        };
      }),
    };
  }
  openNode(nodeId: string, offset = 0, versionId?: string) {
    const { n, v } = this.node(nodeId, !!versionId, versionId);
    const children = v.children.filter((c) => this.allowed.has(c.nodeId));
    return {
      ...this.overview(n, v),
      total: children.length,
      offset,
      truncated: children.length > offset + 20,
      children: children.slice(offset, offset + 20).map((c) => {
        const child = this.node(c.nodeId, true, c.versionId);
        return this.overview(child.n, child.v);
      }),
      historical: !this.active.has(nodeId),
      segment: v.segment,
    };
  }
  history(nodeId: string) {
    const { n } = this.node(nodeId, true);
    return {
      versions: n.history.slice(0, 20).map((v) => this.overview(n, v)),
      total: n.history.length,
      truncated: n.history.length > 20,
    };
  }
  changes(from: number, to: number) {
    if (from < 0 || from > to || to > this.scope.version)
      throw new Error('Change interval outside query snapshot');
    const changes = this.view.all
      .filter((n) => this.allowed.has(n.id))
      .flatMap((n) =>
        n.history
          .filter((v) => v.commitVersion > from && v.commitVersion <= to)
          .map((v) => this.overview(n, v)),
      );
    return {
      timeAxis: 'recorded memory version',
      total: changes.length,
      truncated: changes.length > 40,
      changes: changes.slice(0, 40),
    };
  }
  openSegment(nodeId: string, offset = 0, versionId?: string) {
    const { n, v } = this.node(nodeId, !!versionId, versionId);
    if (!v.segment || !n.revisionId)
      throw new Error('Open a segment to read original evidence');
    const { stage, filename } = this.data.stages.get(n.revisionId)!;
    const content = segmentContent(
      stage,
      v.segment.firstUnit,
      v.segment.lastUnit,
    );
    const register = (
      primitiveId: string,
      kind: 'text' | 'image',
      locator: Citation['locator'],
      first?: number,
      last?: number,
      quote?: string,
    ) => {
      const id = stableId(
        v.id,
        primitiveId,
        String(first ?? ''),
        String(last ?? ''),
      );
      const citation: Citation = {
        id,
        revisionId: stage.id,
        primitiveId,
        nodeId,
        nodeVersionId: v.id,
        filename,
        kind,
        locator,
        first,
        last,
        quote,
        historical: !this.active.has(nodeId),
        url: `/evidence/${stage.id}/${primitiveId}?knownVersion=${this.scope.version}${kind === 'text' ? `&first=${first}&last=${last}` : ''}`,
      };
      this.evidence.set(id, citation);
      return citation;
    };
    const chunks = content.texts.flatMap((t) =>
      Array.from({ length: Math.ceil(t.text.length / 2400) }, (_, i) => ({
        ...t,
        text: t.text.slice(i * 2400, (i + 1) * 2400),
        first: t.first + i * 2400,
        last: Math.min(t.last, t.first + (i + 1) * 2400),
      })),
    );
    const texts = [];
    for (const t of chunks.slice(offset, offset + 5)) {
      if (this.textCharacters + t.text.length > researchLimits.textCharacters) {
        this.warnings.add(
          'Text evidence budget exhausted; coverage is incomplete.',
        );
        break;
      }
      this.textCharacters += t.text.length;
      const c = register(
        t.primitiveId,
        'text',
        t.locator,
        t.first,
        t.last,
        t.text,
      );
      this.inspected.add(c.id);
      texts.push({
        citationId: c.id,
        text: t.text,
        speaker: t.speaker,
        locator: t.locator,
      });
    }
    const images = content.images.map((p) => {
      const c = register(p.id, 'image', p.locator);
      return { citationId: c.id, locator: p.locator };
    });
    return {
      ...this.overview(n, v),
      texts,
      images,
      offset,
      totalTextChunks: chunks.length,
      nextOffset:
        offset + texts.length < chunks.length ? offset + texts.length : null,
      truncated: offset + texts.length < chunks.length,
      historical: !this.active.has(nodeId),
      coverage: stage.coverage,
    };
  }
  image(id: string) {
    const c = this.evidence.get(id);
    if (!c || c.kind !== 'image')
      throw new Error('Open an admitted segment first');
    const p = this.data.stages
      .get(c.revisionId)!
      .stage.primitives.find((p) => p.id === c.primitiveId);
    if (!p || p.kind !== 'image') throw new Error('Image unavailable');
    return { citation: c, assetId: p.assetId };
  }
  validate(value: AnswerProposal): ResearchAnswer {
    if (value.status === 'answered' && !value.claims.length)
      throw new Error('An answered question requires sourced claims');
    if (value.status === 'insufficient_evidence' && !value.limitations.length)
      throw new Error('Explain missing evidence');
    const ids = [...new Set(value.claims.flatMap((c) => c.citations))];
    for (const id of ids)
      if (!this.inspected.has(id) || !this.evidence.has(id))
        throw new Error('Citation was not inspected in this query scope');
    if (value.claims.some((c) => c.text.includes('](')))
      throw new Error('Use citation IDs, not model-generated links');
    return {
      ...value,
      claims: value.claims.map((c) => ({
        ...c,
        text: traditionalChinese(c.text),
      })),
      limitations: value.limitations.map(traditionalChinese),
      snapshot: this.scope,
      citations: ids.map((id) => this.evidence.get(id)!),
      warnings: [...this.warnings],
    };
  }
}
