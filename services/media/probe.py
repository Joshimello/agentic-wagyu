import json, time
from pathlib import Path
import torch
from asr import load, transcribe

root=Path('/data/fixtures')
start=time.monotonic(); load(); cold=time.monotonic()-start
results={'gpu':torch.cuda.get_device_name(0),'torch':torch.__version__,'cuda':torch.version.cuda,'coldLoadSeconds':cold}
for name in ['meeting','meeting-long']:
    result=transcribe(root/f'{name}.mp4')
    results[name]=result
    (root/'runtime.json').write_text(json.dumps(results,indent=2))
    print(json.dumps({'fixture':name,'elapsedSeconds':result['elapsedSeconds'],'peakGiB':result['peakGiB'],'segments':len(result['segments']),'truncated':result['truncated']}),flush=True)
