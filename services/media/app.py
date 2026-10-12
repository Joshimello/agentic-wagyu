import asyncio, tempfile, threading, json, os, traceback, logging, re
from pathlib import Path
from uuid import UUID
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, StrictInt
from starlette.concurrency import run_in_threadpool
import torch
from asr import MODEL, REVISION, MAX_AUDIO_MS, transcribe
from media import ROOT, source, probe, audio_part, contact_sheet
from documents import extract
from jobs import ProcessingCancelled, registry, operation, progress, check_cancelled, commit, cancellable_lock
app=FastAPI(title='Chronicler media',docs_url=None,redoc_url=None)
gpu_lock=threading.Lock()
logger=logging.getLogger('chronicler.media')


def failed_request(message, error):
    def redact(text):
        text=re.sub(r'(https?://)[^\s/@]+:[^\s/@]+@',r'\1[redacted]@',text,flags=re.I)
        text=re.sub(r'\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*',r'\1 [redacted]',text,flags=re.I)
        prefix=r'((?:api[_-]?key|access[_-]?token|password|authorization|secret|token)["\']?\s*[:=]\s*)'
        text=re.sub(prefix+r'(["\'])([\s\S]*?)\2',r'\1\2[redacted]\2',text,flags=re.I)
        text=re.sub(prefix+r'(?!["\']|\[redacted\])[^\s"\'&,}\]]+',r'\1[redacted]',text,flags=re.I)
        return re.sub(r'\bsk-[A-Za-z0-9_-]{8,}','[redacted]',text)
    failure={'type': type(error).__name__, 'message': redact(str(error))[:4000],
             'stack': redact(''.join(traceback.format_exception(error)))[-12000:]}
    logger.error('%s\n%s',message,failure['stack'])
    return HTTPException(500, {
        'message': message,
        'failure': failure,
    })
class SourceRequest(BaseModel):
    storageKey: str
    jobId: UUID | None = None
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


@app.get('/jobs/{job_id}')
def job_status(job_id:UUID):
    job=registry.find(job_id)
    if job is None: raise HTTPException(404,'Media job not found')
    return job.snapshot()


@app.post('/jobs/{job_id}/cancel')
def cancel_job(job_id:UUID):
    return registry.cancel(job_id)


async def execute(request, body, stage, action):
    control=registry.get_or_create(body.jobId)
    def work():
        with operation(control,stage):
            return action()
    task=asyncio.create_task(run_in_threadpool(work))
    try:
        while not task.done():
            done,_=await asyncio.wait({task},timeout=0.25)
            if not done and body.jobId is not None and await request.is_disconnected():
                control.cancel(permanent=False)
        return await task
    except asyncio.CancelledError:
        control.cancel(permanent=False)
        # The worker thread checks the same flag and releases the GPU without killing other runs.
        task.add_done_callback(lambda completed: completed.exception() if not completed.cancelled() else None)
        raise
    except ProcessingCancelled:
        raise HTTPException(409,'Processing cancelled')


@app.post('/probe')
async def inspect(body:SourceRequest, request:Request):
    try: return await execute(request,body,'probing',lambda: probe(source(body.storageKey)))
    except HTTPException: raise
    except Exception: raise HTTPException(422,'Invalid or unavailable media')

@app.post('/document')
async def document(body:DocumentRequest, request:Request):
    try: return await execute(request,body,'extracting_document',lambda: extract(source(body.storageKey),body.format))
    except HTTPException: raise
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception as error: raise failed_request('Document extraction failed; original is preserved and the job can be retried',error)

@app.post('/transcribe')
async def transcript(body:TranscriptRequest, request:Request):
    try: return await execute(request,body,'probing',lambda: transcribe_section(body))
    except HTTPException: raise
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception as error: raise failed_request('Transcription failed; original is preserved and the job can be retried',error)


def transcribe_section(body):
    path=source(body.storageKey);meta=probe(path)
    if body.startMs>=meta['durationMs']: raise ValueError('Audio section starts outside the recording')
    duration=min(body.durationMs,meta['durationMs']-body.startMs)
    if not meta['hasAudio']: return {**meta,'durationMs':duration,'segments':[],'truncated':False,'model':MODEL,'revision':REVISION,'warnings':['No audio stream; transcript unavailable']}
    cache=ROOT/'transcripts'/path.name/f'{REVISION}-{body.startMs}-{duration}-continuous-2.json'
    def cached_result():
        if not body.force and cache.exists():
            try:
                cached=json.loads(cache.read_text())
                if cached['revision']==REVISION and cached['durationMs']==duration and cached['startMs']==body.startMs:
                    progress(stage='cached_transcript',startMs=body.startMs,durationMs=duration,coveredMs=duration,completedUnits=1,totalUnits=1)
                    return {**cached,'cached':True}
            except (ValueError,KeyError): pass
        return None
    cached=cached_result()
    if cached is not None: return cached
    progress(stage='waiting_gpu',startMs=body.startMs,durationMs=duration,totalUnits=1)
    with cancellable_lock(gpu_lock), tempfile.TemporaryDirectory() as tmp:
        cached=cached_result()
        if cached is not None: return cached
        progress(stage='normalizing_audio')
        wav=Path(tmp)/'audio.wav';audio_part(path,wav,body.startMs,duration);result=transcribe(wav)
        check_cancelled()
        result={**result,**meta,'startMs':body.startMs,'durationMs':duration,'cached':False}
        last_end=max((s['end'] for s in result['segments']),default=0)*1000
        if duration-last_end>60000:
            result['incomplete']=True
            result['warnings']=[f'ASR has no timestamped speech in the final {round((duration-last_end)/1000)} seconds. This may be silence or an early model stop; check the original before accepting coverage.']
        cache.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=cache.parent,mode='w',delete=False) as cached_file:
            json.dump(result,cached_file);temp_path=Path(cached_file.name)
        try: commit(lambda: os.replace(temp_path,cache))
        finally: temp_path.unlink(missing_ok=True)
        progress(coveredMs=duration,completedUnits=1)
    return result

@app.post('/contact-sheet')
async def frames(body:FrameRequest, request:Request):
    try: return await execute(request,body,'extracting_frames',lambda: contact_sheet(source(body.storageKey),body.timesMs))
    except HTTPException: raise
    except ValueError as error: raise HTTPException(422,str(error))
    except Exception as error: raise failed_request('Frame extraction failed',error)
