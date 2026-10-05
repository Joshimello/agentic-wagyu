import time
from dataclasses import asdict
import torch
from transformers import AutoModelForCausalLM, AutoProcessor
from moss_transcribe_diarize import parse_transcript
from moss_transcribe_diarize.inference_utils import build_transcription_messages, generate_transcription

MODEL = 'OpenMOSS-Team/MOSS-Transcribe-Diarize'
REVISION = '704aa4a9c304e8520be88901e0d1960158ef5b15'
_model = _processor = None

def load():
    global _model, _processor
    if _model is None:
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA unavailable: media requires its configured local GPU')
        _model = AutoModelForCausalLM.from_pretrained(MODEL, revision=REVISION, trust_remote_code=True, dtype=torch.bfloat16, attn_implementation='sdpa').to('cuda:0').eval()
        _processor = AutoProcessor.from_pretrained(MODEL, revision=REVISION, trust_remote_code=True)
    return _model, _processor

def transcribe(path, max_new_tokens=16384):
    model, processor = load()
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    result = generate_transcription(model, processor, build_transcription_messages(path), max_new_tokens=max_new_tokens, do_sample=False, device=torch.device('cuda:0'), dtype=torch.bfloat16)
    segments = [asdict(s) for s in parse_transcript(result['text'])]
    return {
        **result, 'segments': segments, 'truncated': result['generated_tokens'] >= max_new_tokens,
        'elapsedSeconds': time.monotonic()-started,
        'peakGiB': torch.cuda.max_memory_allocated()/1024**3,
        'model': MODEL, 'revision': REVISION,
    }
