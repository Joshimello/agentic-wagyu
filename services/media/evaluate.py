"""Evaluate the frozen pilot without changing its thresholds."""
import json, re, difflib
from pathlib import Path

def words(text): return re.findall(r"[a-z0-9]+",text.lower().replace('twelve','12'))
def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        nxt=[i]
        for j,y in enumerate(b,1): nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=nxt
    return row[-1]

def evaluate(runtime, gold, pilot):
    short=runtime['meeting']; segments=short['segments']; expected=[]; actual=[]; owner=[]; observed=[]
    for i,t in enumerate(gold['turns']):
        w=words(t['text']); expected.extend(w); owner.extend([i]*len(w))
    for i,s in enumerate(segments):
        w=words(s['text']); actual.extend(w); observed.extend([i]*len(w))
    matched={i:[] for i in range(len(gold['turns']))}
    for block in difflib.SequenceMatcher(None,expected,actual,autojunk=False).get_matching_blocks():
        for j in range(block.size): matched[owner[block.a+j]].append(observed[block.b+j])
    errors=[]
    for i,t in enumerate(gold['turns']):
        indices=matched[i]
        if not indices: errors.extend([float('inf')]*2); continue
        errors.extend([abs(segments[min(indices)]['start']*1000-t['startMs']),abs(segments[max(indices)]['end']*1000-t['endMs'])])
    limits=pilot['thresholds']; wer=distance(expected,actual)/len(expected)
    timing=sum(e<=limits['timestampToleranceMs'] for e in errors)/len(errors)
    checks={
      'wordErrorRate':wer<=limits['wordErrorRateMax'],
      'timestamps':timing>=limits['timestampWithinToleranceMin'],
      'speakers':len(set(s['speaker'] for s in segments))>=limits['distinctSpeakersMin'],
      'runtime':all(runtime[n]['elapsedSeconds']<=limits['runtimeSecondsMax'] for n in ['meeting','meeting-long']),
      'gpuMemory':all(runtime[n]['peakGiB']<=limits['gpuPeakGiBMax'] for n in ['meeting','meeting-long']),
      'notTruncated':all(not runtime[n]['truncated'] for n in ['meeting','meeting-long'])
    }
    return {'checks':checks,'wordErrorRate':wer,'timestampWithinTolerance':timing,'boundaryErrorsMs':errors,'speakers':sorted(set(s['speaker'] for s in segments))}

if __name__=='__main__':
    root=Path('/data/fixtures')
    result=evaluate(json.loads((root/'runtime.json').read_text()),json.loads((root/'gold.json').read_text()),json.loads(Path('/evals/pilot.json').read_text()))
    (root/'quality.json').write_text(json.dumps(result,indent=2)); print(json.dumps(result,indent=2))
    if not all(result['checks'].values()): raise SystemExit(1)
