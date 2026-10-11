import type { Primitive, Stage } from './server/contracts';

export type ImageEvidence = Extract<Primitive, { kind: 'image' }>;
export type VisualAnnotation = Stage['annotations'][number];
export type GalleryFrame = {
  assetId: string;
  sources: ImageEvidence[];
};
export type ObservationGroup = {
  id: string;
  annotations: VisualAnnotation[];
  observations: { text: string; annotations: VisualAnnotation[] }[];
  frames: GalleryFrame[];
  transcriptIds: string[];
  questionIds: string[];
};

export type ObservationBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'description'; heading: string; text: string }
  | { kind: 'list'; items: string[] }
  | {
      kind: 'pipeline';
      introduction: string;
      steps: string[];
      conclusion: string;
    };
export type FormattedObservation = {
  title: string | null;
  subtitle: string | null;
  blocks: ObservationBlock[];
};

export function formatTime(ms: number, precise = false): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const time = hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
  return precise && ms % 1000
    ? `${time}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`
    : time;
}

function unquote(value: string): string {
  const text = value.trim();
  return /^(?:"[^"\n]*"|'[^'\n]*'|\u201c[^\u201d\n]*\u201d|\u2018[^\u2019\n]*\u2019)$/.test(
    text,
  )
    ? text.slice(1, -1)
    : text;
}

function labeledValue(value: string): { value: string; remainder: string } {
  const quoted = value
    .trim()
    .match(
      /^("[^"\n]*"|'[^'\n]*'|\u201c[^\u201d\n]*\u201d|\u2018[^\u2019\n]*\u2019)([\s\S]*)$/,
    );
  return quoted
    ? { value: unquote(quoted[1]), remainder: quoted[2].trim() }
    : { value: value.trim(), remainder: '' };
}

// Recognize explicit labels and arrows only; free-form evidence stays verbatim.
export function formatObservation(text: string): FormattedObservation {
  let body = text.trim();
  let title: string | null = null;
  let subtitle: string | null = null;
  const heading = body.match(
    /^(?:slide\s+)?title\s*:\s*(.+?)(?=\s*(?:\u2014|\u2013|\n|;)\s*(?:slide\s+)?subtitle\s*:|\n|$)/i,
  );
  if (heading) {
    const label = labeledValue(heading[1]);
    title = label.value;
    body = body
      .slice(heading[0].length)
      .replace(/^\s*(?:\u2014|\u2013|;)\s*/, '')
      .trim();
    const subheading = body.match(
      /^(?:slide\s+)?subtitle\s*:\s*([^\n]+)(?:\n|$)/i,
    );
    if (subheading) {
      const subtitleLabel = labeledValue(subheading[1]);
      subtitle = subtitleLabel.value;
      body = [
        label.remainder,
        subtitleLabel.remainder,
        body.slice(subheading[0].length).trim(),
      ]
        .filter(Boolean)
        .join('\n\n');
    } else if (label.remainder) {
      body = [label.remainder, body].filter(Boolean).join('\n\n');
    }
  }

  const blocks: ObservationBlock[] = [];
  for (const paragraph of body.split(/\n\s*\n/).filter(Boolean)) {
    const pipeline = quotedPipeline(paragraph);
    if (pipeline) {
      blocks.push(pipeline);
      continue;
    }
    const description = paragraph.match(
      /^((?:Visual samples?|Diagram|Chart|Comparison|Layout|Observation|On-screen text|Slide content)[^:\n]{0,55}):\s+([\s\S]+)$/i,
    );
    if (description) {
      blocks.push({
        kind: 'description',
        heading: description[1],
        text: description[2],
      });
      continue;
    }
    const lines = paragraph.split('\n');
    if (
      lines.length > 1 &&
      lines.every((line) => /^\s*(?:[-*\u2022]|\d+[.)])\s+/.test(line))
    ) {
      blocks.push({
        kind: 'list',
        items: lines.map((line) =>
          line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, ''),
        ),
      });
    } else {
      blocks.push({ kind: 'paragraph', text: paragraph });
    }
  }
  return { title, subtitle, blocks };
}

function quotedPipeline(
  text: string,
): Extract<ObservationBlock, { kind: 'pipeline' }> | null {
  const quoted =
    /(?:'[^'\n]+'|"[^"\n]+"|\u2018[^\u2019\n]+\u2019|\u201c[^\u201d\n]+\u201d)/g;
  const matches = [...text.matchAll(quoted)];
  for (let start = 0; start < matches.length - 1; start++) {
    let end = start;
    while (end + 1 < matches.length) {
      const current = matches[end];
      const next = matches[end + 1];
      const between = text.slice(
        current.index! + current[0].length,
        next.index,
      );
      if (!/^\s*(?:->|\u2192|\u27f6)\s*$/.test(between)) break;
      end++;
    }
    if (end > start) {
      const final = matches[end];
      return {
        kind: 'pipeline',
        introduction: text
          .slice(0, matches[start].index)
          .trim()
          .replace(/:\s*$/, ''),
        steps: matches.slice(start, end + 1).map((match) => unquote(match[0])),
        conclusion: text
          .slice(final.index! + final[0].length)
          .trim()
          .replace(/^\.\s*/, ''),
      };
    }
  }
  return null;
}

export function galleryFrames(frames: ImageEvidence[]): GalleryFrame[] {
  const byAsset = new Map<string, GalleryFrame>();
  for (const frame of frames) {
    let entry = byAsset.get(frame.assetId);
    if (!entry) {
      entry = { assetId: frame.assetId, sources: [] };
      byAsset.set(frame.assetId, entry);
    }
    if (!entry.sources.some((source) => source.id === frame.id))
      entry.sources.push(frame);
  }
  return [...byAsset.values()];
}

export function groupVisualObservations(
  stage: Pick<Stage, 'annotations' | 'primitives'> &
    Partial<Pick<Stage, 'context'>>,
): ObservationGroup[] {
  const images = new Map(
    stage.primitives
      .filter((p): p is ImageEvidence => p.kind === 'image')
      .map((p) => [p.id, p]),
  );
  const questionFrames = new Map(
    stage.context?.questions.map((question) => [
      question.id,
      question.searches.flatMap((search) => search.frameIds),
    ]) ?? [],
  );
  function referencedFrames(annotation: VisualAnnotation): ImageEvidence[] {
    return [
      ...annotation.frameIds,
      ...(annotation.questionId
        ? (questionFrames.get(annotation.questionId) ?? [])
        : []),
    ].flatMap((ref) => (images.get(ref) ? [images.get(ref)!] : []));
  }
  const parents = stage.annotations.map((_, index) => index);
  const owners = new Map<string, number>();
  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  // Exact shared assets or a shared research question form one evidence gallery.
  stage.annotations.forEach((annotation, index) => {
    const keys = referencedFrames(annotation).map(
      (frame) => `asset:${frame.assetId}`,
    );
    if (annotation.questionId) keys.push(`question:${annotation.questionId}`);
    for (const key of keys) {
      const owner = owners.get(key);
      if (owner !== undefined) parents[root(index)] = root(owner);
      else owners.set(key, index);
    }
  });
  const groups = new Map<number, VisualAnnotation[]>();
  stage.annotations.forEach((annotation, index) => {
    const key = root(index);
    const group = groups.get(key) ?? [];
    group.push(annotation);
    groups.set(key, group);
  });
  return [...groups.values()].map((annotations) => {
    const observations = new Map<
      string,
      { text: string; annotations: VisualAnnotation[] }
    >();
    for (const annotation of annotations) {
      const key = annotation.text.trim().replace(/\s+/g, ' ');
      const observation = observations.get(key) ?? {
        text: annotation.text,
        annotations: [],
      };
      observation.annotations.push(annotation);
      observations.set(key, observation);
    }
    const citedFrames = annotations.flatMap(referencedFrames);
    const citedAssets = new Set(citedFrames.map((frame) => frame.assetId));
    return {
      id: annotations[0].id,
      annotations,
      observations: [...observations.values()],
      frames: galleryFrames([
        ...citedFrames,
        ...[...images.values()].filter((frame) =>
          citedAssets.has(frame.assetId),
        ),
      ]),
      transcriptIds: [...new Set(annotations.flatMap((a) => a.transcriptIds))],
      questionIds: [
        ...new Set(
          annotations.flatMap((a) => (a.questionId ? [a.questionId] : [])),
        ),
      ],
    };
  });
}
