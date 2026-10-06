import type { Stage, Primitive } from '../../contracts';
export type SourceBlock = {
  stage: Stage;
  index: number;
  primitives: Primitive[];
  annotations: { text: string; evidenceRefs: string[] }[];
};
/** Read every text character/page. Long primitives use bounded source slices with their original evidence IDs. */
export function sourceBlocks(stage: Stage): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let selected: Primitive[] = [],
    characters = 0,
    imageCount = 0;
  const flush = () => {
    if (!selected.length) return;
    const ids = new Set(selected.map((p) => p.id));
    const annotations = stage.document
      ? []
      : stage.annotations.filter((a) =>
          a.transcriptIds.some((id) => ids.has(id)),
        );
    const frameIds = [...new Set(annotations.flatMap((a) => a.frameIds))].slice(
      0,
      4,
    );
    const images = stage.primitives.filter(
      (p) => frameIds.includes(p.id) && !ids.has(p.id),
    );
    blocks.push({
      stage,
      index: blocks.length,
      primitives: [...selected, ...images],
      annotations: annotations.map((a) => ({
        text: a.text,
        evidenceRefs: [
          ...a.transcriptIds.filter((id) => ids.has(id)),
          ...a.frameIds.filter((id) => frameIds.includes(id)),
        ],
      })),
    });
    selected = [];
    characters = 0;
    imageCount = 0;
  };
  const add = (p: Primitive) => {
    const length = p.kind === 'text' ? p.text.length : 0;
    if (
      selected.length &&
      (characters + length > 8000 ||
        selected.length >= 250 ||
        (p.kind === 'image' && imageCount >= 4))
    )
      flush();
    selected.push(p);
    characters += length;
    if (p.kind === 'image') imageCount++;
  };
  const addSource = (p: Primitive) => {
    if (p.kind === 'image') {
      add(p);
      return;
    }
    if (!p.text.length) {
      add(p);
      return;
    }
    for (let offset = 0; offset < p.text.length; offset += 8000)
      add({ ...p, text: p.text.slice(offset, offset + 8000) });
  };
  if (stage.document) {
    for (const unit of stage.document.units) {
      const render = stage.primitives.find((p) => p.id === unit.renderId)!;
      addSource(render);
      for (const id of unit.textIds)
        addSource(stage.primitives.find((p) => p.id === id)!);
    }
  } else {
    for (const p of stage.primitives.filter((p) => p.kind === 'text'))
      addSource(p);
    if (!selected.length && !blocks.length)
      for (const p of stage.primitives.slice(0, 4)) addSource(p);
  }
  flush();
  return blocks;
}
