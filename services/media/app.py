from fastapi import FastAPI
import torch
from asr import MODEL, REVISION
app=FastAPI(title='Chronicler media',docs_url=None,redoc_url=None)
@app.get('/health')
def health():
    return {'ok':torch.cuda.is_available(),'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,'model':MODEL,'revision':REVISION}
