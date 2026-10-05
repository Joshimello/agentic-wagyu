import copy, time
from dataclasses import asdict
import torch
from transformers import AutoModelForCausalLM, AutoProcessor
from moss_transcribe_diarize import parse_transcript
from moss_transcribe_diarize.inference_utils import build_transcription_messages, prepare_inputs

MODEL = 'OpenMOSS-Team/MOSS-Transcribe-Diarize'
REVISION = '704aa4a9c304e8520be88901e0d1960158ef5b15'
MAX_AUDIO_MS = 90 * 60 * 1000
_model = _processor = None

def load():
    global _model, _processor
    if _model is None:
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA unavailable: media requires its configured local GPU')
        _model = AutoModelForCausalLM.from_pretrained(MODEL, revision=REVISION, trust_remote_code=True, dtype=torch.bfloat16, attn_implementation='sdpa').to('cuda:0').eval()
        _processor = AutoProcessor.from_pretrained(MODEL, revision=REVISION, trust_remote_code=True)
    return _model, _processor

def output_budget(prompt_tokens, context_tokens, requested=65536):
    budget=min(requested,context_tokens-prompt_tokens-128)
    if budget<=0: raise ValueError('Audio input leaves no transcription context; shorten the recording window')
    return budget

def transcribe(path, max_new_tokens=65536):
    model, processor = load()
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    with torch.inference_mode(), torch.amp.autocast('cuda',dtype=torch.bfloat16):
        inputs=prepare_inputs(processor,build_transcription_messages(path),max_length=model.config.text_config.max_position_embeddings,device=torch.device('cuda:0')).to('cuda:0')
        prompt_tokens=inputs['input_ids'].shape[1]
        token_budget=output_budget(prompt_tokens,model.config.text_config.max_position_embeddings,max_new_tokens)
        generation=copy.deepcopy(model.generation_config)
        generation.max_new_tokens=token_budget
        generation.do_sample=False
        print(f'MOSS input tokens={prompt_tokens}, output budget={token_budget}',flush=True)
        output=model.generate(input_ids=inputs['input_ids'],attention_mask=inputs['attention_mask'],input_features=inputs['input_features'],audio_feature_lengths=inputs['audio_feature_lengths'],audio_chunk_mapping=inputs['audio_chunk_mapping'],generation_config=generation)
    ids=output[0][prompt_tokens:]
    text=processor.tokenizer.decode(ids,skip_special_tokens=True).strip()
    segments = [asdict(s) for s in parse_transcript(text)]
    eos=generation.eos_token_id
    return {
        'text':text,'prompt_len':prompt_tokens,'generated_tokens':int(ids.numel()),
        'segments': segments, 'truncated': int(ids.numel()) >= token_budget, 'tokenBudget':token_budget,
        'endedWithEOS':bool(ids.numel() and int(ids[-1]) in (eos if isinstance(eos,list) else [eos])),
        'elapsedSeconds': time.monotonic()-started,
        'peakGiB': torch.cuda.max_memory_allocated()/1024**3,
        'model': MODEL, 'revision': REVISION,
    }
