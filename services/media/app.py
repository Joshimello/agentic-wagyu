import tempfile, threading, json, os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, StrictInt
import torch
from asr import MODEL, REVISION, MAX_AUDIO_MS, transcribe
from media import ROOT, source, probe, audio_part, contact_sheet
from documents import extract
app=FastAPI(title='Chronicler media',docs_url=None,redoc_url=None)
gpu_lock=threading.Lock()
class SourceRequest(BaseModel):
    storageKey: str
class DocumentRequest(SourceRequest):
    format: str
class FrameRequest(SourceRequest):
    timesMs: list[StrictInt] = Field(min_length=1,max_length=8)
class TranscriptRequest(SourceRequest):
    startMs: StrictInt = Field(default=0,ge=0)
    durationMs: StrictInt = Field(default=MAX_AUDIO_MS,gt=0,le=MAX_AUDIO_MS)
    force: bool = False
@app.get('/health')
def health():
    return {'ok':torch.cuda.is_available(),'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,'model':MODEL,'revision':REVISION}

@app.post('/probe')
def inspect(body:SourceRequest):
    try: return probe(source(body.storageKey))
    except Exception: raise HTTPException(422,'Invalid or unavailable media')

@app.post('/document')
def document(body:DocumentRequest):
    try: return extract(source(body.storageKey),body.format)
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception: raise HTTPException(500,'Document extraction failed; original is preserved and the job can be retried')

@app.post('/transcribe')
def transcript(body:TranscriptRequest):
    try:
        path=source(body.storageKey);meta=probe(path)
        if body.startMs>=meta['durationMs']: raise ValueError('Audio section starts outside the recording')
        duration=min(body.durationMs,meta['durationMs']-body.startMs)
        if not meta['hasAudio']: return {**meta,'durationMs':duration,'segments':[],'truncated':False,'model':MODEL,'revision':REVISION,'warnings':['No audio stream; transcript unavailable']}
        with gpu_lock, tempfile.TemporaryDirectory() as tmp:
            cache=ROOT/'transcripts'/path.name/f'{REVISION}-{body.startMs}-{duration}-continuous-2.json'
            if not body.force and cache.exists():
                try:
                    cached=json.loads(cache.read_text())
                    if cached['revision']==REVISION and cached['durationMs']==duration and cached['startMs']==body.startMs:
                        return {**cached,'cached':True}
                except (ValueError,KeyError): pass
            wav=Path(tmp)/'audio.wav';audio_part(path,wav,body.startMs,duration);result=transcribe(wav)
            result={**result,**meta,'startMs':body.startMs,'durationMs':duration,'cached':False}
            last_end=max((s['end'] for s in result['segments']),default=0)*1000
            if duration-last_end>60000:
                result['incomplete']=True
                result['warnings']=[f'ASR has no timestamped speech in the final {round((duration-last_end)/1000)} seconds. This may be silence or an early model stop; check the original before accepting coverage.']
            cache.parent.mkdir(parents=True,exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=cache.parent,mode='w',delete=False) as cached_file:
                json.dump(result,cached_file);temp_path=Path(cached_file.name)
            os.replace(temp_path,cache)
        return result
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception: raise HTTPException(500,'Transcription failed; original is preserved and the job can be retried')

@app.post('/contact-sheet')
def frames(body:FrameRequest):
    try: return contact_sheet(source(body.storageKey),body.timesMs)
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception: raise HTTPException(500,'Frame extraction failed')
