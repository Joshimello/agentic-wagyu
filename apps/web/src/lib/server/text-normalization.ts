import { Converter } from 'opencc-js/cn2t';
import type { Stage } from './contracts';

// OpenCC standard Traditional Chinese, without regional vocabulary substitution.
const convert = Converter({ from: 'cn', to: 't' });
export const transcriptNormalization = {
  engine: 'opencc-js',
  version: '1.4.2',
  conversion: 's2t',
} as const;

export function traditionalChinese(text: string) {
  return convert(text);
}

/** Normalize reviewable speech; raw MOSS checkpoints and source media stay intact. */
export function normalizeTranscription(stage: Stage) {
  const prior = stage.provenance.textNormalization;
  if (
    prior?.engine === transcriptNormalization.engine &&
    prior.version === transcriptNormalization.version &&
    prior.conversion === transcriptNormalization.conversion
  )
    return;
  let hasSpeech = false;
  for (const primitive of stage.primitives)
    if (primitive.kind === 'text' && primitive.role === 'asr') {
      primitive.text = traditionalChinese(primitive.text);
      hasSpeech = true;
    }
  if (hasSpeech)
    stage.provenance.textNormalization = { ...transcriptNormalization };
}
