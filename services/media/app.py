import tempfile, threading
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, StrictInt
import torch
from asr import MODEL, REVISION, transcribe
from media import source, probe, audio_part, contact_sheet
app=FastAPI(title='Chronicler media',docs_url=None,redoc_url=None)
gpu_lock=threading.Lock()
class SourceRequest(BaseModel):
    storageKey: str
class FrameRequest(SourceRequest):
    timesMs: list[StrictInt] = Field(min_length=1,max_length=8)
class TranscriptRequest(SourceRequest):
    startMs: StrictInt = Field(default=0,ge=0)
    durationMs: StrictInt = Field(default=180000,gt=0,le=180000)
@app.get('/health')
def health():
    return {'ok':torch.cuda.is_available(),'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,'model':MODEL,'revision':REVISION}

@app.post('/probe')
def inspect(body:SourceRequest):
    try: return probe(source(body.storageKey))
    except Exception: raise HTTPException(422,'Invalid or unavailable media')

@app.post('/transcribe')
def transcript(body:TranscriptRequest):
    try:
        path=source(body.storageKey);meta=probe(path)
        if body.startMs>=meta['durationMs']: raise ValueError('Audio section starts outside the recording')
        duration=min(body.durationMs,meta['durationMs']-body.startMs)
        if not meta['hasAudio']: return {**meta,'durationMs':duration,'segments':[],'truncated':False,'model':MODEL,'revision':REVISION,'warnings':['No audio stream; transcript unavailable']}
        with gpu_lock, tempfile.TemporaryDirectory() as tmp:
            wav=Path(tmp)/'audio.wav';audio_part(path,wav,body.startMs,duration);result=transcribe(wav)
        return {**result,**meta,'startMs':body.startMs,'durationMs':duration}
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception: raise HTTPException(500,'Transcription failed; original is preserved and the job can be retried')

@app.post('/contact-sheet')
def frames(body:FrameRequest):
    try: return contact_sheet(source(body.storageKey),body.timesMs)
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception: raise HTTPException(500,'Frame extraction failed')
