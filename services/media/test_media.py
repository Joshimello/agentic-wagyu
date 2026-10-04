import tempfile, unittest, subprocess, wave
from pathlib import Path
import numpy as np
from PIL import Image
from media import contact_sheet,probe,audio,source

class Media(unittest.TestCase):
    def test_reject_invalid_source_keys(self):
        for key in ['../.env','/etc/passwd','assets/aa/../../.env','https://example.com/movie.mp4']:
            with self.assertRaises(ValueError):source(key)
    def test_bad_frame_requests(self):
        path=Path('/data/fixtures/meeting.mp4');duration=probe(path)['durationMs']
        for times in [[],[-1],[duration],[1.5],[True],[100,100],list(range(9))]:
            with self.assertRaises(ValueError):contact_sheet(path,times)
    def test_variable_frame_rate_uses_actual_presentation_times(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);times=[0,200,800,1800]
            for n in range(4):Image.new('RGB',(320,180),(n*60,0,0)).save(root/f'{n}.png')
            (root/'frames.txt').write_text(''.join(f"file '{root}/{n}.png'\nduration {d}\n" for n,d in enumerate([.2,.6,1,1]))+f"file '{root}/3.png'\n")
            path=root/'vfr.mp4';subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(root/'frames.txt'),'-fps_mode','vfr','-c:v','libx264','-pix_fmt','yuv420p',str(path)],check=True)
            sheet=contact_sheet(path,[0,250,850]);actual=[f['actualMs'] for f in sheet['frames']]
            self.assertEqual(actual,[0,800,1800]);self.assertEqual([f['requestedMs'] for f in sheet['frames']],[0,250,850])
    def test_delayed_audio_preserves_container_offset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'offset.mp4'
            subprocess.run(['ffmpeg','-y','-v','error','-itsoffset','1.5','-i','/data/fixtures/meeting.wav','-i','/data/fixtures/meeting.mp4','-map','1:v:0','-map','0:a:0','-c:v','copy','-c:a','aac',str(path)],check=True)
            wav=root/'audio.wav';audio(path,wav)
            with wave.open(str(wav),'rb') as w: samples=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16);rate=w.getframerate()
            first=np.flatnonzero(np.abs(samples)>300)[0]/rate
            self.assertGreater(first,2.35);self.assertLess(first,2.7)

if __name__=='__main__':unittest.main()
