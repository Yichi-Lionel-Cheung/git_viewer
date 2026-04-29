from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass

from .history import GitHistoryBuilder
from .payloads import history_to_payload


@dataclass
class HistoryJob:
    job_id: str
    repo_text: str
    ref: str
    status: str = "queued"
    done: int = 0
    total: int = 0
    message: str = "Queued"
    result: dict[str, object] | None = None
    error: str | None = None


class HistoryJobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, HistoryJob] = {}
        self._lock = threading.Lock()

    def start(self, repo_text: str, ref: str) -> str:
        job_id = uuid.uuid4().hex
        job = HistoryJob(job_id=job_id, repo_text=repo_text, ref=ref)
        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(
            target=self._run,
            args=(job_id,),
            daemon=True,
            name=f"history-loader-{job_id[:8]}",
        )
        thread.start()
        return job_id

    def payload(self, job_id: str) -> dict[str, object] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            return _history_job_payload(job)

    def _run(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            repo_text = job.repo_text
            ref = job.ref
            job.status = "running"
            job.message = "Resolving repository"

        def progress(done: int, total: int, message: str) -> None:
            with self._lock:
                current = self._jobs.get(job_id)
                if current is None:
                    return
                current.status = "running"
                current.done = done
                current.total = total
                current.message = message

        try:
            builder = GitHistoryBuilder(repo_text, ref)
            history = builder.build(progress=progress)
            payload = history_to_payload(history)
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                current = self._jobs.get(job_id)
                if current is not None:
                    current.status = "error"
                    current.error = str(exc)
                    current.message = "Load failed"
            return

        with self._lock:
            current = self._jobs.get(job_id)
            if current is not None:
                current.status = "done"
                current.done = max(current.done, current.total)
                current.message = "Complete"
                current.result = payload


def _history_job_payload(job: HistoryJob) -> dict[str, object]:
    payload: dict[str, object] = {
        "job_id": job.job_id,
        "status": job.status,
        "done": job.done,
        "total": job.total,
        "message": job.message,
    }
    if job.result is not None:
        payload["result"] = job.result
    if job.error is not None:
        payload["error"] = job.error
    return payload
