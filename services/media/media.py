import hashlib, io, json, math, os, re, subprocess, tempfile
from pathlib import Path
import av
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(os.environ.get('DATA_ROOT','/data')).resolve()

def source(key):
    if not re.fullmatch(r'assets/[0-9a-f]{2}/[0-9a-f]{64}',key): raise ValueError('Invalid raw asset key')
    path=(ROOT/key).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file(): raise ValueError('Raw asset unavailable')
    return path

def probe(path):
    result=subprocess.run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)],capture_output=True,text=True,check=True,timeout=30)
    meta=json.loads(result.stdout); duration=float(meta['format']['duration']); origin=float(meta['format'].get('start_time',0))
    if not math.isfinite(duration) or duration<=0: raise ValueError('Invalid media duration')
    return {'durationMs':round(duration*1000),'originSeconds':origin,'hasAudio':any(s['codec_type']=='audio' for s in meta['streams']),'hasVideo':any(s['codec_type']=='video' for s in meta['streams'])}

def audio(path,dest):
    # Preserve offsets/gaps, normalize the container start to zero, and pad delayed audio.
    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-copyts','-start_at_zero','-i',str(path),'-vn','-af','aresample=16000:async=1:first_pts=0','-ac','1','-ar','16000',str(dest)],check=True,timeout=120)

def store_image(img):
    buf=io.BytesIO();img.save(buf,format='JPEG',quality=88);data=buf.getvalue();digest=hashlib.sha256(data).hexdigest()
    key=f'assets/{digest[:2]}/{digest}';path=ROOT/key;path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as tmp: tmp.write(data);temp=Path(tmp.name)
        try: os.link(temp,path)
        except FileExistsError: pass
        finally: temp.unlink()
    return {'storageKey':key,'sha256':digest,'bytes':len(data),'mime':'image/jpeg'}

def contact_sheet(path,times):
    meta=probe(path);duration=meta['durationMs'];origin=meta['originSeconds']
    if not meta['hasVideo']: raise ValueError('No video stream')
    if not 1<=len(times)<=8 or len(set(times))!=len(times) or any(type(t) is not int or t<0 or t>=duration for t in times): raise ValueError('Request 1–8 unique integer timestamps within the container timeline')
    pending=sorted(times); frames=[]; previous=None
    # Decode real presentation timestamps instead of deriving frame numbers from FPS.
    with av.open(str(path)) as container:
        for frame in container.decode(video=0):
            if frame.time is None: continue
            actual=round((frame.time-origin)*1000)
            if actual<0: continue
            previous=(frame,actual)
            while pending and actual>=pending[0]:
                requested=pending.pop(0)
                if actual>=duration: continue
                img=frame.to_image().convert('RGB');img.thumbnail((1280,720))
                frames.append({'requestedMs':requested,'actualMs':actual,'width':img.width,'height':img.height,'asset':store_image(img),'image':img})
            if not pending: break
    if pending and previous:
        frame,actual=previous
        for requested in pending:
            img=frame.to_image().convert('RGB');img.thumbnail((1280,720))
            frames.append({'requestedMs':requested,'actualMs':actual,'width':img.width,'height':img.height,'asset':store_image(img),'image':img})
    if len(frames)!=len(times): raise ValueError('Requested frames could not be decoded')
    sheet=Image.new('RGB',(640*min(2,len(frames)),390*math.ceil(len(frames)/2)), '#101b2a');draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
    for n,frame in enumerate(frames):
        thumb=frame.pop('image');thumb.thumbnail((620,340));x=(n%2)*640;y=(n//2)*390
        sheet.paste(thumb,(x+10,y+35));draw.text((x+10,y+6),f'Frame {n+1} | requested {frame["requestedMs"]} ms | actual {frame["actualMs"]} ms',font=font,fill='white')
    return {'frames':frames,'sheet':store_image(sheet),'durationMs':duration}
