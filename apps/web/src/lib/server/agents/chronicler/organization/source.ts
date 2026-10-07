import type { Stage, Primitive } from '../../../contracts';
export type SourceUnit = {
  index: number;
  locator: Primitive['locator'];
  textRefs: { primitiveId: string; first: number; last: number }[];
  imageIds: string[];
};
/** Version 1 source-unit definition. Preserve it for already published segment ranges. */
export function sourceUnits(stage: Stage): SourceUnit[] {
  const units: SourceUnit[] = [];
  const primitives = new Map(stage.primitives.map((p) => [p.id, p]));
  const add = (
    locator: Primitive['locator'],
    textIds: string[],
    imageIds: string[],
  ) => {
    let refs: SourceUnit['textRefs'] = [],
      size = 0;
    const flush = () => {
      units.push({ index: units.length, locator, textRefs: refs, imageIds });
      refs = [];
      size = 0;
    };
    for (const id of textIds) {
      const p = primitives.get(id);
      if (!p || p.kind !== 'text')
        throw new Error('Source text primitive is unavailable');
      if (!p.text.length) refs.push({ primitiveId: id, first: 0, last: 0 });
      for (let first = 0; first < p.text.length;) {
        if (size === 8000) flush();
        const last = Math.min(p.text.length, first + 8000 - size);
        refs.push({ primitiveId: id, first, last });
        size += last - first;
        first = last;
      }
    }
    if (refs.length || imageIds.length) flush();
  };
  if (stage.document) {
    for (const unit of stage.document.units) {
      const render = primitives.get(unit.renderId);
      if (!render) throw new Error('Source render is unavailable');
      add(render.locator, unit.textIds, [unit.renderId]);
    }
  } else {
    for (const p of stage.primitives.filter((p) => p.kind === 'text'))
      add(p.locator, [p.id], []);
    if (!units.length)
      for (const p of stage.primitives.filter((p) => p.kind === 'image'))
        add(p.locator, [], [p.id]);
  }
  return units;
}
export function unitContent(stage: Stage, unit: SourceUnit) {
  return unit.textRefs.map((r) => {
    const p = stage.primitives.find((p) => p.id === r.primitiveId)!;
    if (p.kind !== 'text') throw new Error('Invalid source text');
    return {
      primitiveId: p.id,
      text: p.text.slice(r.first, r.last),
      speaker: p.speaker,
      role: p.role,
      locator: p.locator,
      first: r.first,
      last: r.last,
    };
  });
}
export function unitBlocks(stage: Stage) {
  const blocks: SourceUnit[][] = [];
  let current: SourceUnit[] = [],
    size = 0,
    images = 0;
  for (const unit of sourceUnits(stage)) {
    const length = unit.textRefs.reduce((n, r) => n + r.last - r.first, 0);
    if (
      current.length &&
      (size + length > 10000 ||
        current.length >= 180 ||
        images + unit.imageIds.length > 4)
    ) {
      blocks.push(current);
      current = [];
      size = 0;
      images = 0;
    }
    current.push(unit);
    size += length;
    images += unit.imageIds.length;
  }
  if (current.length) blocks.push(current);
  return blocks;
}
export function segmentContent(
  stage: Stage,
  first: number,
  last: number,
  allUnits = sourceUnits(stage),
) {
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first < 0 ||
    first > last ||
    last >= allUnits.length
  )
    throw new Error('Segment outside source');
  const units = allUnits.slice(first, last + 1);
  const texts = units.flatMap((u) => unitContent(stage, u));
  const textIds = new Set(texts.map((t) => t.primitiveId));
  const imageIds = new Set(units.flatMap((u) => u.imageIds));
  const annotations = stage.annotations.filter((a) =>
    a.transcriptIds.some((id) => textIds.has(id)),
  );
  annotations.forEach((a) => a.frameIds.forEach((id) => imageIds.add(id)));
  const images = stage.primitives.filter(
    (p) => p.kind === 'image' && imageIds.has(p.id),
  );
  return { units, texts, images, annotations };
}
