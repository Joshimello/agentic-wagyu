"""Per-run cooperative cancellation shared by media operations and model generation."""

import contextvars
import os
import signal
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone


class ProcessingCancelled(RuntimeError):
    pass


class JobControl:
    def __init__(self, job_id=None):
        self.job_id = job_id
        self.cancelled = threading.Event()
        self._lock = threading.RLock()
        self._permanent = False
        self._active = 0
        self._had_failure = False
        self._state = {
            "jobId": job_id, "status": "queued", "stage": "queued",
            "completedUnits": 0, "totalUnits": None, "coveredMs": 0,
            "durationMs": None, "startMs": 0, "generatedTokens": 0,
        }
        self._touch()

    def _touch(self):
        self._state["updatedAt"] = datetime.now(timezone.utc).isoformat()

    def check(self):
        if self.cancelled.is_set():
            raise ProcessingCancelled("Processing cancelled")

    def update(self, **values):
        with self._lock:
            self.check()
            self._state.update(values)
            self._touch()

    def cancel(self, permanent=True):
        with self._lock:
            self._permanent = self._permanent or permanent
            self.cancelled.set()
            self._state.update(status="cancelled", stage="cancelled")
            self._touch()
            return self.snapshot()

    def snapshot(self):
        with self._lock:
            return {**self._state, "cancelled": self.cancelled.is_set(),
                    "permanentCancellation": self._permanent, "activeOperations": self._active}

    def can_retry(self):
        with self._lock:
            return self.cancelled.is_set() and not self._permanent and self._active == 0

    def begin(self, stage):
        with self._lock:
            self.check()
            if self._active == 0:
                self._had_failure = False
                self._state.update(stage=stage, completedUnits=0, totalUnits=None,
                                   coveredMs=0, durationMs=None, startMs=0, generatedTokens=0)
            self._active += 1
            self._state["status"] = "running"
            self._touch()

    def finish(self, failed=False):
        with self._lock:
            self._active -= 1
            self._had_failure = self._had_failure or failed
            if not self.cancelled.is_set() and self._active == 0:
                status = "failed" if self._had_failure else "completed"
                self._state.update(status=status, stage=status)
            self._touch()

    def commit(self, action):
        # Cancellation and cache publication have one ordering; partial results never publish.
        with self._lock:
            self.check()
            return action()


class JobRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs = {}

    def get_or_create(self, job_id):
        if job_id is None:
            return JobControl()
        key = str(job_id)
        with self._lock:
            control = self._jobs.get(key)
            if control is None or control.can_retry():
                # Replace the control, never clear an old flag still observed by a generator.
                self._jobs[key] = JobControl(key)
            return self._jobs[key]

    def cancel(self, job_id, permanent=True):
        key = str(job_id)
        with self._lock:
            if key not in self._jobs:
                self._jobs[key] = JobControl(key)
            return self._jobs[key].cancel(permanent=permanent)

    def find(self, job_id):
        with self._lock:
            return self._jobs.get(str(job_id))


registry = JobRegistry()
_current = contextvars.ContextVar("media_job", default=None)


def current_job():
    return _current.get()


def check_cancelled():
    job = current_job()
    if job is not None:
        job.check()


def progress(**values):
    job = current_job()
    if job is not None:
        job.update(**values)


def commit(action):
    job = current_job()
    return job.commit(action) if job is not None else action()


@contextmanager
def operation(control, stage):
    token = _current.set(control)
    entered = False
    failed = False
    try:
        control.begin(stage)
        entered = True
        yield control
        control.check()
    except ProcessingCancelled:
        control.cancel(permanent=False)
        raise
    except BaseException:
        failed = True
        raise
    finally:
        if entered:
            control.finish(failed=failed)
        _current.reset(token)


@contextmanager
def cancellable_lock(lock):
    acquired = False
    try:
        while not acquired:
            check_cancelled()
            acquired = lock.acquire(timeout=0.1)
        check_cancelled()
        yield
    finally:
        if acquired:
            lock.release()


def run_command(args, *, timeout, check=True, capture_output=False, text=False, **kwargs):
    """Stop only this operation's child command when its run is cancelled."""
    job = current_job()
    if job is None:
        return subprocess.run(args, timeout=timeout, check=check,
                              capture_output=capture_output, text=text, **kwargs)
    job.check()
    started = time.monotonic()
    with subprocess.Popen(args, stdout=subprocess.PIPE if capture_output else None,
                          stderr=subprocess.PIPE if capture_output else None,
                          text=text, start_new_session=os.name == "posix", **kwargs) as process:
        try:
            while True:
                job.check()
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(args, timeout)
                try:
                    stdout, stderr = process.communicate(timeout=min(0.1, remaining))
                    job.check()
                    break
                except subprocess.TimeoutExpired:
                    continue
        except BaseException:
            def stop(sig):
                try:
                    if os.name == "posix":
                        os.killpg(process.pid, sig)
                    elif sig == signal.SIGTERM:
                        process.terminate()
                    else:
                        process.kill()
                except ProcessLookupError:
                    pass
            stop(signal.SIGTERM)
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                stop(signal.SIGKILL if os.name == "posix" else signal.SIGTERM)
                process.communicate()
            raise
    result = subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
    if check:
        result.check_returncode()
    return result
