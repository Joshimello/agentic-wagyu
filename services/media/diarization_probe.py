"""Temporary prompt comparison; records failures rather than changing pilot gold."""
import json
from dataclasses import asdict
from pathlib import Path
import torch
from asr import load
from moss_transcribe_diarize.inference_utils import build_transcription_messages,generate_transcription,DEFAULT_PROMPT
from moss_transcribe_diarize import parse_transcript
model,processor=load()
prompts=[DEFAULT_PROMPT+' 请仔细区分不同的说话人，不要将声音或口音不同的人合并为同一说话人。', 'Transcribe this audio verbatim in its original language. Identify distinct speakers by their voice and accent, keeping speaker IDs consistent. Each segment must use the format [start_seconds][S01]text[end_seconds]. Use S02, S03 and so on only when the speaker changes.']
results=[]
for prompt in prompts:
    result=generate_transcription(model,processor,build_transcription_messages('/data/fixtures/meeting.mp4',prompt=prompt),max_new_tokens=2048,do_sample=False,device=torch.device('cuda:0'),dtype=torch.bfloat16)
    results.append({'prompt':prompt,'text':result['text'],'segments':[asdict(s) for s in parse_transcript(result['text'])]})
    print(json.dumps({'speakers':sorted(set(s['speaker'] for s in results[-1]['segments'])),'text':result['text']}),flush=True)
Path('/data/fixtures/diarization-prompts.json').write_text(json.dumps(results,indent=2))
