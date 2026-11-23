"""Background job runner for long storage operations (create volume, wipe...)."""
from __future__ import annotations

import json
import threading
import time
import traceback
import uuid
from typing import Callable, Dict, List, Optional

from .util import CommandError, UserError


def steps(log: Callable[[str], None], labels: List[str]) -> Callable[..., None]:
    """Tell the web interface the steps of a job; it shows them with a progress bar.
    Returns go(n, detail=""), which marks step n (from 1) as running.
    A line starting with "RESULT " is shown when the job has finished."""
    log("STEPS " + json.dumps(labels))

    def go(n: int, detail: str = "") -> None:
        log(f"STEP {n}" + (f" {detail}" if detail else ""))
    return go


class Job:
    def __init__(self, title: str, user: str):
        self.id = uuid.uuid4().hex[:12]
        self.title = title
        self.user = user
        self.status = "queued"   # queued | running | success | error
        self.error: Optional[str] = None
        self.log: List[str] = []
        self.started = time.time()
        self.finished: Optional[float] = None

    def write(self, line: str) -> None:
        for part in str(line).splitlines() or [""]:
            self.log.append(part)
        del self.log[:-2000]

    def to_dict(self, with_log: bool = False) -> dict:
        d = {"id": self.id, "title": self.title, "user": self.user, "status": self.status,
             "error": self.error, "started": self.started, "finished": self.finished}
        if with_log:
            d["log"] = list(self.log)
        return d


class JobRunner:
    def __init__(self, on_done: Optional[Callable[[Job], None]] = None,
                 on_start: Optional[Callable[[Job], None]] = None):
        self.jobs: Dict[str, Job] = {}
        self._storage_lock = threading.Lock()
        self._on_done = on_done
        self._on_start = on_start

    def submit(self, title: str, user: str, fn: Callable[[Callable[[str], None]], None]) -> Job:
        job = Job(title, user)
        self.jobs[job.id] = job
        if self._on_start:
            try:
                self._on_start(job)
            except Exception:
                pass
        if len(self.jobs) > 100:
            for old in sorted(self.jobs.values(), key=lambda j: j.started)[: len(self.jobs) - 100]:
                if old.status not in ("queued", "running"):
                    self.jobs.pop(old.id, None)

        def target():
            with self._storage_lock:   # one storage operation at a time
                job.status = "running"
                job.write(f"== {title}")
                try:
                    fn(job.write)
                    job.status = "success"
                    job.write("== done")
                except (UserError, CommandError) as e:
                    job.status = "error"
                    job.error = str(e)
                    job.write(f"!! {e}")
                except Exception as e:  # pragma: no cover - unexpected
                    job.status = "error"
                    job.error = f"{type(e).__name__}: {e}"
                    job.write(traceback.format_exc())
                finally:
                    job.finished = time.time()
                    if self._on_done:
                        try:
                            self._on_done(job)
                        except Exception:
                            pass

        threading.Thread(target=target, name=f"job-{job.id}", daemon=True).start()
        return job

    def list(self) -> List[dict]:
        return [j.to_dict() for j in sorted(self.jobs.values(), key=lambda j: -j.started)]

    def get(self, job_id: str) -> Optional[Job]:
        return self.jobs.get(job_id)
