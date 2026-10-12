"""Cancellation is scoped to one run and never publishes incomplete evidence."""

import asyncio
import json
import sys
import tempfile
import threading
import time
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import torch
import app
import asr
import media
import documents
from PIL import Image
from jobs import (
    JobControl, JobRegistry, ProcessingCancelled, cancellable_lock,
    check_cancelled, operation, progress, run_command,
)


class Cancellation(unittest.TestCase):
    def test_cached_transcription_does_not_wait_for_the_gpu(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'immutable-recording'
            cache = root / 'transcripts' / source.name / f'{app.REVISION}-5000-1000-continuous-2.json'
            cache.parent.mkdir(parents=True)
            cache.write_text(json.dumps({'revision': app.REVISION, 'startMs': 5000, 'durationMs': 1000, 'segments': []}))
            body = app.TranscriptRequest(storageKey='unused', startMs=5000, durationMs=1000)
            control = JobControl()
            with patch.object(app, 'ROOT', root), patch.object(app, 'source', return_value=source), \
                 patch.object(app, 'probe', return_value={'durationMs': 6000, 'hasAudio': True}), \
                 patch.object(app, 'cancellable_lock', side_effect=AssertionError('Cache hits must not acquire the GPU')), \
                 operation(control, 'probing'):
                result = app.transcribe_section(body)
            self.assertTrue(result['cached'])
            self.assertEqual(control.snapshot()['coveredMs'], 1000)
            self.assertEqual(control.snapshot()['startMs'], 5000)
            self.assertEqual(control.snapshot()['durationMs'], 1000)

    def test_pre_dispatch_cancel_is_permanent_for_only_that_run(self):
        registry = JobRegistry()
        cancelled_id, next_id = uuid4(), uuid4()
        cancelled = registry.get_or_create(cancelled_id)
        cancelled.cancel()
        with self.assertRaises(ProcessingCancelled), operation(registry.get_or_create(cancelled_id), "transcribing"):
            self.fail("Cancelled work must not start")
        self.assertEqual(cancelled.snapshot()["status"], "cancelled")
        with operation(registry.get_or_create(next_id), "transcribing"):
            check_cancelled()
        self.assertEqual(registry.find(next_id).snapshot()["status"], "completed")

    def test_transient_cancel_only_retries_after_every_old_operation_exits(self):
        registry = JobRegistry()
        job_id = uuid4()
        old = registry.get_or_create(job_id)
        tokenizer = Mock()
        stopping = asr.JobStoppingCriteria(old, tokenizer, 0)
        ids = torch.zeros((1, 1), dtype=torch.long)
        with self.assertRaises(ProcessingCancelled), operation(old, "transcribing"):
            with self.assertRaises(ProcessingCancelled), operation(old, "extracting_frames"):
                old.cancel(permanent=False)
                self.assertEqual(old.snapshot()["activeOperations"], 2)
                self.assertIs(registry.get_or_create(job_id), old)
                with self.assertRaises(ProcessingCancelled), operation(old, "transcribing"):
                    self.fail("A retry must not start while canceled work still owns resources")
                self.assertEqual(old.snapshot()["activeOperations"], 2)
            self.assertEqual(old.snapshot()["activeOperations"], 1)
            self.assertIs(registry.get_or_create(job_id), old)
        self.assertEqual(old.snapshot()["activeOperations"], 0)
        retried = registry.get_or_create(job_id)
        self.assertIsNot(retried, old)
        self.assertTrue(stopping(ids, None).item())
        self.assertFalse(retried.cancelled.is_set())
        with operation(retried, "transcribing"):
            check_cancelled()

    def test_explicit_cancel_upgrades_transient_control_and_never_resets(self):
        registry = JobRegistry()
        job_id = uuid4()
        control = registry.get_or_create(job_id)
        with self.assertRaises(ProcessingCancelled), operation(control, "transcribing"):
            control.cancel(permanent=False)
            result = registry.cancel(job_id)
            self.assertTrue(result["permanentCancellation"])
        self.assertIs(registry.get_or_create(job_id), control)
        control.cancel(permanent=False)
        self.assertTrue(control.snapshot()["permanentCancellation"])
        with self.assertRaises(ProcessingCancelled), operation(control, "transcribing"):
            self.fail("An explicit cancellation cannot be cleared by a retry")

    def test_cancelling_gpu_wait_does_not_release_another_runs_lock(self):
        lock = threading.Lock()
        lock.acquire()
        control = JobControl(str(uuid4()))
        timer = threading.Timer(0.05, control.cancel)
        timer.start()
        try:
            with self.assertRaises(ProcessingCancelled), operation(control, "waiting_gpu"), cancellable_lock(lock):
                self.fail("Cancelled GPU wait must not enter")
            self.assertTrue(lock.locked())
        finally:
            timer.join()
            lock.release()

    def test_child_process_is_stopped_for_cancelled_run(self):
        control = JobControl(str(uuid4()))
        timer = threading.Timer(0.1, control.cancel)
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(ProcessingCancelled), operation(control, "normalizing_audio"):
                run_command([sys.executable, "-c", "import time; time.sleep(30)"], timeout=40)
            self.assertLess(time.monotonic() - started, 5)
        finally:
            timer.join()

    def test_process_output_and_exit_errors_are_preserved(self):
        with operation(JobControl(), "probing"):
            result = run_command([sys.executable, "-c", "print('ready')"], timeout=5, capture_output=True, text=True)
        self.assertEqual(result.stdout.strip(), "ready")

    def test_progress_is_work_based_and_cancel_cannot_be_overwritten(self):
        control = JobControl()
        with self.assertRaises(ProcessingCancelled), operation(control, "extracting_frames"):
            progress(totalUnits=3, completedUnits=1, coveredMs=1250)
            control.cancel()
            progress(completedUnits=2)
        self.assertEqual(control.snapshot()["completedUnits"], 1)
        self.assertEqual(control.snapshot()["coveredMs"], 1250)
        self.assertEqual(control.snapshot()["status"], "cancelled")

    def test_cancelled_transcription_preserves_previous_complete_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "recording"
            original.write_bytes(b"raw evidence")
            cache = root / "transcripts" / original.name / f"{asr.REVISION}-0-1000-continuous-2.json"
            cache.parent.mkdir(parents=True)
            complete = {"revision": asr.REVISION, "startMs": 0, "durationMs": 1000,
                        "segments": [{"end": 1}], "text": "previous complete result"}
            cache.write_text(json.dumps(complete))
            control = JobControl()

            def partial(_):
                control.cancel()
                return {"segments": [], "text": "partial"}

            patches = (patch.object(app, "ROOT", root), patch.object(app, "source", return_value=original),
                       patch.object(app, "probe", return_value={"durationMs": 1000, "hasAudio": True}),
                       patch.object(app, "audio_part"), patch.object(app, "transcribe", side_effect=partial))
            with patches[0], patches[1], patches[2], patches[3], patches[4] as generated:
                body = app.TranscriptRequest(storageKey="unused", durationMs=1000, force=True)
                with self.assertRaises(ProcessingCancelled), operation(control, "transcribing"):
                    app.transcribe_section(body)
                self.assertEqual(json.loads(cache.read_text()), complete)
                self.assertEqual(original.read_bytes(), b"raw evidence")
                generated.reset_mock()
                with operation(JobControl(), "transcribing"):
                    result = app.transcribe_section(body.model_copy(update={"force": False}))
                self.assertTrue(result["cached"])
                generated.assert_not_called()

    def test_cancelled_document_stops_between_pages_and_keeps_finished_render(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.pdf"
            first, second = Image.new("RGB", (120, 80), "white"), Image.new("RGB", (120, 80), "gray")
            first.save(source, "PDF", save_all=True, append_images=[second])
            control = JobControl()
            original_store = documents.store_image
            completed = []

            def store_and_cancel(image):
                asset = original_store(image)
                completed.append(asset)
                control.cancel()
                return asset

            with patch.object(documents, "ROOT", root), patch.object(media, "ROOT", root), \
                 patch.object(documents, "store_image", side_effect=store_and_cancel):
                with self.assertRaises(ProcessingCancelled), operation(control, "extracting_document"):
                    documents.extract(source, "pdf")
            self.assertEqual(len(completed), 1)
            self.assertTrue((root / completed[0]["storageKey"]).is_file())
            self.assertTrue(source.is_file())
            self.assertFalse((root / "documents" / source.name).exists())

    def test_frame_progress_counts_real_decoded_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            run_command(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                         "color=c=white:s=64x64:r=2:d=2", "-c:v", "libx264", str(source)], timeout=30)
            control = JobControl()
            with patch.object(media, "ROOT", root), operation(control, "extracting_frames"):
                result = media.contact_sheet(source, [0, 500])
                self.assertEqual(control.snapshot()["completedUnits"], 2)
                self.assertEqual(control.snapshot()["totalUnits"], 2)
            self.assertEqual(len(result["frames"]), 2)
            self.assertTrue((root / result["sheet"]["storageKey"]).is_file())


class ModelStopping(unittest.TestCase):
    def test_timestamp_progress_and_cancellation_are_isolated(self):
        control, other = JobControl(), JobControl()
        tokenizer = Mock()
        tokenizer.decode.return_value = "[0.00][S01]Hello[2.50][2.50][S02]World[4.00]"
        criteria = asr.JobStoppingCriteria(control, tokenizer, 3)
        ids = torch.zeros((1, 35), dtype=torch.long)
        self.assertFalse(criteria(ids, None).item())
        self.assertEqual(control.snapshot()["coveredMs"], 4000)
        self.assertEqual(control.snapshot()["generatedTokens"], 32)
        control.cancel()
        self.assertTrue(criteria(ids, None).item())
        self.assertFalse(asr.JobStoppingCriteria(other, tokenizer, 3)(ids, None).item())

    def test_progress_decode_is_bounded_for_long_transcripts(self):
        tokenizer = Mock()
        tokenizer.decode.return_value = ""
        criteria = asr.JobStoppingCriteria(JobControl(), tokenizer, 3)
        criteria(torch.zeros((1, 10000), dtype=torch.long), None)
        self.assertEqual(tokenizer.decode.call_args.args[0].numel(), 1024)

    def test_generation_receives_stopping_criteria_and_discards_cancelled_output(self):
        control = JobControl()
        inputs = {"input_ids": torch.zeros((1, 3), dtype=torch.long), "attention_mask": None,
                  "input_features": None, "audio_feature_lengths": None, "audio_chunk_mapping": None}
        prepared = Mock()
        prepared.to.return_value = inputs
        steps = []

        def generate(**kwargs):
            for step in range(20):
                steps.append(step)
                if step == 2:
                    control.cancel()
                output = torch.zeros((1, 4 + step), dtype=torch.long)
                if kwargs["stopping_criteria"](output, None).all():
                    return output
            self.fail("Generation ignored cancellation")

        model = SimpleNamespace(config=SimpleNamespace(text_config=SimpleNamespace(max_position_embeddings=1024)),
                                generation_config=SimpleNamespace(eos_token_id=0), generate=generate)
        with patch.object(asr, "load", return_value=(model, Mock())), \
             patch.object(asr, "prepare_inputs", return_value=prepared), \
             patch.object(asr, "build_transcription_messages", return_value=[]), \
             patch.object(torch.cuda, "reset_peak_memory_stats"), \
             patch.object(torch.amp, "autocast", return_value=nullcontext()):
            with self.assertRaises(ProcessingCancelled), operation(control, "transcribing"):
                asr.transcribe(Path("unused.wav"))
        self.assertEqual(steps, [0, 1, 2])


class JobApi(unittest.IsolatedAsyncioTestCase):
    async def test_transcription_failure_reports_the_original_engine_exception(self):
        body = app.TranscriptRequest(storageKey='unused', jobId=uuid4())
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        with patch.object(app, 'transcribe_section', side_effect=RuntimeError('GPU allocation failed password="two secret words"')), \
             self.assertLogs('chronicler.media', level='ERROR') as captured:
            with self.assertRaises(app.HTTPException) as caught:
                await app.transcript(body, request)
        self.assertEqual(caught.exception.status_code, 500)
        failure = caught.exception.detail['failure']
        self.assertEqual(failure['type'], 'RuntimeError')
        self.assertEqual(failure['message'], 'GPU allocation failed password="[redacted]"')
        self.assertIn('RuntimeError: GPU allocation failed', failure['stack'])
        self.assertNotIn('secret words', '\n'.join(captured.output))
        self.assertEqual(app.job_status(body.jobId)['status'], 'failed')

    async def test_cancel_endpoint_blocks_later_dispatch_but_allows_new_run(self):
        job_id = uuid4()
        first = app.cancel_job(job_id)
        second = app.cancel_job(job_id)
        self.assertTrue(first["cancelled"])
        self.assertEqual(second["status"], "cancelled")
        action = Mock(return_value={"ok": True})
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        with self.assertRaises(app.HTTPException) as caught:
            await app.execute(request, app.SourceRequest(storageKey="unused", jobId=job_id), "probing", action)
        self.assertEqual(caught.exception.status_code, 409)
        action.assert_not_called()
        next_id = uuid4()
        result = await app.execute(request, app.SourceRequest(storageKey="unused", jobId=next_id), "probing", action)
        self.assertTrue(result["ok"])
        self.assertEqual(app.job_status(next_id)["status"], "completed")

    async def test_disconnected_worker_cancels_its_cooperative_operation(self):
        job_id = uuid4()
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=True))

        def work():
            while True:
                check_cancelled()
                time.sleep(0.01)

        with self.assertRaises(app.HTTPException) as caught:
            await asyncio.wait_for(app.execute(request, app.SourceRequest(storageKey="unused", jobId=job_id), "transcribing", work), timeout=3)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertTrue(app.job_status(job_id)["cancelled"])
        old = app.registry.find(job_id)
        self.assertFalse(old.snapshot()["permanentCancellation"])
        self.assertEqual(old.snapshot()["activeOperations"], 0)
        retry_request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        result = await app.execute(retry_request, app.SourceRequest(storageKey="unused", jobId=job_id), "probing", lambda: {"retried": True})
        self.assertTrue(result["retried"])
        self.assertIsNot(app.registry.find(job_id), old)
        self.assertTrue(old.cancelled.is_set())

    async def test_aborted_request_keeps_old_gpu_work_cancelled_until_release(self):
        job_id = uuid4()
        acquired, release = threading.Event(), threading.Event()
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        body = app.SourceRequest(storageKey="unused", jobId=job_id)

        def work():
            with cancellable_lock(app.gpu_lock):
                acquired.set()
                release.wait(timeout=3)
                check_cancelled()

        task = asyncio.create_task(app.execute(request, body, "transcribing", work))
        try:
            for _ in range(100):
                if acquired.is_set():
                    break
                await asyncio.sleep(0.01)
            self.assertTrue(acquired.is_set())
            old = app.registry.find(job_id)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(app.gpu_lock.locked())
            self.assertEqual(old.snapshot()["activeOperations"], 1)
            self.assertFalse(old.snapshot()["permanentCancellation"])
            retry = Mock(return_value={"retried": True})
            with self.assertRaises(app.HTTPException) as caught:
                await app.execute(request, body, "transcribing", retry)
            self.assertEqual(caught.exception.status_code, 409)
            retry.assert_not_called()
        finally:
            release.set()
        for _ in range(100):
            if old.snapshot()["activeOperations"] == 0:
                break
            await asyncio.sleep(0.01)
        self.assertEqual(old.snapshot()["activeOperations"], 0)
        self.assertFalse(app.gpu_lock.locked())
        result = await app.execute(request, body, "transcribing", retry)
        self.assertTrue(result["retried"])
        self.assertTrue(old.cancelled.is_set())
        self.assertIsNot(app.registry.find(job_id), old)


if __name__ == "__main__":
    unittest.main()
