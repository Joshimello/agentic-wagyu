"""Media invariants exercised on real meeting footage; all transforms are temporary."""
import os, tempfile, unittest, subprocess, wave
from pathlib import Path
import numpy as np
import media
from media import contact_sheet,probe,audio,source

class Media(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recording=Path(os.environ.get('TEST_RECORDING','/data/recordings/2026-09-08.mp4'))
        if not cls.recording.exists(): raise unittest.SkipTest('Set TEST_RECORDING to a real meeting video')
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.old_root=media.ROOT;media.ROOT=self.root
    def tearDown(self):
        media.ROOT=self.old_root;self.tmp.cleanup()
    def test_reject_invalid_source_keys(self):
        for key in ['../.env','/etc/passwd','assets/aa/../../.env','https://example.com/movie.mp4']:
            with self.assertRaises(ValueError):source(key)
    def test_bad_frame_requests(self):
        duration=probe(self.recording)['durationMs']
        for times in [[],[-1],[duration],[1.5],[True],[100,100],list(range(9))]:
            with self.assertRaises(ValueError):contact_sheet(self.recording,times)
    def test_variable_frame_rate_uses_actual_presentation_times(self):
        import av
        with av.open(str(self.recording)) as container:
            for n,frame in enumerate(container.decode(video=0)):
                frame.to_image().save(self.root/f'{n}.png')
                if n==3:break
        (self.root/'frames.txt').write_text(''.join(f"file '{self.root}/{n}.png'\nduration {d}\n" for n,d in enumerate([.2,.6,1,1]))+f"file '{self.root}/3.png'\n")
        path=self.root/'vfr.mp4';subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(self.root/'frames.txt'),'-fps_mode','vfr','-c:v','libx264','-pix_fmt','yuv420p',str(path)],check=True)
        sheet=contact_sheet(path,[0,250,850])
        self.assertEqual([f['actualMs'] for f in sheet['frames']],[0,800,1800])
        self.assertEqual([f['requestedMs'] for f in sheet['frames']],[0,250,850])
    def test_delayed_audio_preserves_container_offset(self):
        # Compare normalized audio from the same real excerpt with/without a 1.5s delay.
        clip=self.root/'clip.mp4'
        subprocess.run(['ffmpeg','-y','-v','error','-ss','130','-i',str(self.recording),'-t','8','-c:v','libx264','-c:a','aac',str(clip)],check=True)
        delayed=self.root/'offset.mp4'
        subprocess.run(['ffmpeg','-y','-v','error','-itsoffset','1.5','-i',str(clip),'-i',str(clip),'-map','1:v:0','-map','0:a:0','-c:v','copy','-c:a','copy',str(delayed)],check=True)
        starts=[]
        for n,path in enumerate([clip,delayed]):
            wav=self.root/f'{n}.wav';audio(path,wav)
            with wave.open(str(wav),'rb') as w:
                samples=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16);rate=w.getframerate()
            starts.append(np.flatnonzero(np.abs(samples)>300)[0]/rate)
        self.assertAlmostEqual(starts[1]-starts[0],1.5,delta=.05)
    def test_long_video_seek_records_actual_timestamps(self):
        duration=probe(self.recording)['durationMs']
        sheet=contact_sheet(self.recording,[duration//2,duration-1000])
        for frame in sheet['frames']:
            self.assertGreaterEqual(frame['actualMs'],frame['requestedMs'])
            self.assertLess(frame['actualMs'],duration)

if __name__=='__main__':unittest.main()
