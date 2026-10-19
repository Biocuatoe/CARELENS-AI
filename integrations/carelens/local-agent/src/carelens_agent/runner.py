"""Job loop with an explicit priority policy for the shared RTX 2060.

Policy (simple and testable):
1. Vision jobs and report jobs run on separate lanes; the GPU is used by one of them at a time.
2. The report lane only claims with defer_if_vision_pending=true, so the backend gives it nothing while
   vision work is queued.
3. When the vision lane claims a job it sets `preempt`; a running report generation stops at its next
   streamed chunk, the report job is released (the attempt is not counted) and retried afterwards.
   Vision inference therefore never waits for the LLM.
4. Ollama is called with keep_alive=0 by default, so the LLM is unloaded after each report and the
   Vision server keeps its VRAM. Simultaneous residency of both models has only been measured once
   (see README); it is not assumed to be safe under load.

Frames live in memory only and are wiped after each job, success or failure.
"""
from __future__ import annotations

import gc
import logging
import platform
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from . import __version__
from .cloud import CloudClient, CloudError, InvalidResponse, TransientError, backoff_delays
from .config import AgentConfig
from .frames import InputRejected, unpack, wipe
from .summarizer import GenerationCancelled, OllamaClient, OllamaUnavailable, ReportInvalid, generate_report
from .vision import VisionClient, VisionProtocolError, VisionRejected, VisionUnavailable, analyze

log = logging.getLogger("carelens_agent")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class LeaseKeeper:
    """Renews a job lease every lease/3 seconds until stopped."""

    def __init__(self, cloud: CloudClient, job: dict[str, Any], seconds: int) -> None:
        self._cloud, self._job, self._seconds = cloud, job, seconds
        self._stop = threading.Event()
        self.lost = False
        self._thread = threading.Thread(target=self._run, name=f"lease-{job['job_id'][-6:]}", daemon=True)

    def __enter__(self) -> LeaseKeeper:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(self._seconds / 3):
            try:
                self._cloud.renew(self._job["job_id"], self._job["lease_token"], self._seconds)
            except CloudError as exc:
                log.warning("lease %s lost (%s)", self._job["job_id"], exc.code)
                self.lost = True
                return
            except TransientError as exc:
                log.warning("lease renewal for %s failed transiently: %s", self._job["job_id"], exc)


class Agent:
    def __init__(
        self,
        config: AgentConfig,
        cloud: CloudClient | None = None,
        vision: VisionClient | None = None,
        ollama: OllamaClient | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self.config = config
        self.cloud = cloud or CloudClient(config.backend_url, config.agent_token, config.backend_timeout_s)
        self.vision = vision or VisionClient(config.vision_url, config.vision_timeout_s)
        self.ollama = ollama or OllamaClient(config.ollama_url, config.summary_model, config.ollama_timeout_s, config.ollama_keep_alive, config.ollama_num_ctx)
        self.stop = threading.Event()
        self.preempt = threading.Event()
        self.vision_wake = threading.Event()
        self.report_wake = threading.Event()
        self.report_busy = threading.Event()
        self.stats = {"vision_completed": 0, "vision_failed": 0, "reports_completed": 0, "reports_failed": 0, "reports_preempted": 0}
        # Reported in the heartbeat for the owner's status view: times and error codes only, never payloads.
        self.health: dict[str, Any] = {"last_vision_completed_at": None, "last_report_completed_at": None, "last_failure": None}

    # ------------------------------------------------------------------ vision

    def process_vision(self, job: dict[str, Any]) -> str:
        payload = job["payload"]
        job_id, token = job["job_id"], job["lease_token"]
        chunks: list[bytearray] = []
        try:
            with LeaseKeeper(self.cloud, job, self.config.lease_seconds):
                frames = []
                for media in payload["media"]:
                    chunk = self.cloud.media(job_id, int(media["chunk_index"]), token)
                    chunks.append(chunk)
                    frames.extend(unpack(chunk, int(media["frame_end"]) - int(media["frame_start"]) + 1))
                started = time.perf_counter()
                result, timings = analyze(payload, frames, self.vision, self.config.package_version)
                frames.clear()
                result["idempotency_key"] = f"{job_id}:attempt-{job['attempt']}"
                outcome = self.cloud.complete(job_id, token, result, stop=self.stop)
            imu = payload.get("imu_window") or {}
            log.info(
                "vision job %s capture=%s mode=%s done in %.0f ms (fall %.0f ms, drink %.0f ms, scrub=%s) imu_at_claim=%s imu_now=%s fusion_pending=%s decisions=%d alerts=%d media_deleted=%s",
                job_id, payload.get("capture_id"), payload.get("mode"), (time.perf_counter() - started) * 1000,
                timings.get("fall_ms", 0), timings.get("drink_ms", 0), bool(timings.get("scrubbed")),
                imu.get("state"), outcome.get("imu_state"), outcome.get("fusion_pending"),
                len(outcome.get("decision_ids", [])), len(outcome.get("alert_ids", [])), outcome.get("media_deleted"),
            )
            self.stats["vision_completed"] += 1
            self.health["last_vision_completed_at"] = _utc_now()
            return "completed"
        except InputRejected as exc:
            return self._fail(job, "invalid_media", False, str(exc))
        except VisionRejected as exc:
            return self._fail(job, "vision_rejected_input", False, str(exc))
        except VisionProtocolError as exc:
            return self._fail(job, "vision_protocol_error", False, str(exc))
        except VisionUnavailable as exc:
            return self._fail(job, "vision_unavailable", True, str(exc))
        except CloudError as exc:
            # 409/410: lease lost, job expired or media already deleted; nothing to retry from here.
            log.warning("vision job %s ended by backend: %s %s", job_id, exc.status, exc.code)
            if exc.status == 422:
                return self._fail(job, "result_rejected", False, exc.code)
            return "abandoned"
        finally:
            wipe(*chunks)
            chunks.clear()
            gc.collect()

    def _fail(self, job: dict[str, Any], code: str, retryable: bool, detail: str) -> str:
        log.warning("job %s failed: %s (retryable=%s)", job["job_id"], code, retryable)
        self.health["last_failure"] = {"at": _utc_now(), "kind": job.get("kind"), "code": code}
        if job.get("kind") == "vision":
            self.stats["vision_failed"] += 1
        else:
            self.stats["reports_failed"] += 1
        try:
            return self.cloud.fail(job["job_id"], job["lease_token"], code, retryable, detail[:300])
        except (CloudError, TransientError) as exc:
            log.warning("could not report failure of %s: %s (the lease will expire and be recovered)", job["job_id"], exc)
            return "unreported"

    # ------------------------------------------------------------------ reports

    def process_report(self, job: dict[str, Any]) -> str:
        job_id, token = job["job_id"], job["lease_token"]
        self.report_busy.set()
        try:
            with LeaseKeeper(self.cloud, job, self.config.lease_seconds):
                result = generate_report(self.ollama, job["payload"], self.preempt)
                result["idempotency_key"] = f"{job_id}:attempt-{job['attempt']}"
                self.cloud.complete(job_id, token, result, stop=self.stop)
            log.info("report job %s (%s) completed: eval_count=%s attempts=%s", job_id, job["payload"].get("input", {}).get("report_date"), result["inference"]["eval_count"], result["inference"]["attempts"])
            self.stats["reports_completed"] += 1
            self.health["last_report_completed_at"] = _utc_now()
            return "completed"
        except GenerationCancelled:
            self.stats["reports_preempted"] += 1
            log.info("report job %s preempted by vision work; releasing", job_id)
            try:
                self.cloud.release(job_id, token, "preempted_by_vision")
            except (CloudError, TransientError) as exc:
                log.warning("release of %s failed: %s", job_id, exc)
            return "preempted"
        except OllamaUnavailable as exc:
            return self._fail(job, "ollama_unavailable", True, str(exc))
        except ReportInvalid as exc:
            return self._fail(job, "llm_output_invalid", True, str(exc))
        except CloudError as exc:
            log.warning("report job %s ended by backend: %s %s", job_id, exc.status, exc.code)
            if exc.status == 422:
                return self._fail(job, "result_rejected", True, exc.detail or exc.code)
            return "abandoned"
        finally:
            self.report_busy.clear()

    # ------------------------------------------------------------------ lanes

    def vision_lane(self) -> None:
        delays = backoff_delays(1, 60)
        while not self.stop.is_set():
            try:
                job = self.cloud.claim(["vision"], self.config.lease_seconds, False)
                delays = backoff_delays(1, 60)
            except (TransientError, InvalidResponse) as exc:
                wait = next(delays)
                log.warning("vision claim failed (%s); retry in %.0fs", exc, wait)
                self.stop.wait(wait)
                continue
            except CloudError as exc:
                log.error("vision claim rejected: %s %s; retry in 60s", exc.status, exc.code)
                self.stop.wait(60)
                continue
            if job is None:
                self.vision_wake.wait(self.config.poll_interval_s)
                self.vision_wake.clear()
                continue
            self.preempt.set()
            if self.report_busy.is_set():
                self.ollama.abort()
            deadline = time.monotonic() + 10
            while self.report_busy.is_set() and time.monotonic() < deadline:
                time.sleep(0.05)
            try:
                self.process_vision(job)
            finally:
                self.preempt.clear()
                self.report_wake.set()

    def report_lane(self) -> None:
        delays = backoff_delays(5, 300)
        while not self.stop.is_set():
            if self.preempt.is_set():
                self.stop.wait(0.5)
                continue
            try:
                job = self.cloud.claim(["daily_report"], self.config.lease_seconds, True)
                delays = backoff_delays(5, 300)
            except (TransientError, InvalidResponse) as exc:
                wait = next(delays)
                log.warning("report claim failed (%s); retry in %.0fs", exc, wait)
                self.stop.wait(wait)
                continue
            except CloudError as exc:
                log.error("report claim rejected: %s %s; retry in 300s", exc.status, exc.code)
                self.stop.wait(300)
                continue
            if job is None:
                self.report_wake.wait(self.config.report_poll_interval_s)
                self.report_wake.clear()
                continue
            self.process_report(job)

    def hint_listener(self) -> None:
        delays = backoff_delays(1, 120)
        while not self.stop.is_set():
            try:
                for hint in self.cloud.hints(self.stop):
                    delays = backoff_delays(1, 120)
                    if hint.get("type") == "job_available":
                        (self.vision_wake if hint.get("kind") == "vision" else self.report_wake).set()
                # The server ends streams after SSE_MAX_LIFETIME_SECONDS: reconnect at once.
            except (TransientError, CloudError) as exc:
                wait = next(delays)
                log.info("hint stream interrupted (%s); reconnect in %.0fs (polling continues)", exc, wait)
                self.stop.wait(wait)

    def heartbeat_loop(self) -> None:
        while not self.stop.is_set():
            info: dict[str, Any] = {"agent_version": __version__, "python": platform.python_version(), "package_version": self.config.package_version, "summary_model": self.config.summary_model}
            try:
                h = self.vision.health()
                info["vision"] = {"fall_heads": h["fall_heads"], "drink": h["drink"]}
            except (VisionUnavailable, VisionRejected, VisionProtocolError):
                info["vision"] = "unavailable"
            try:
                info["ollama_model_digest"] = self.ollama.model_digest()
            except OllamaUnavailable:
                info["ollama_model_digest"] = "unavailable"
            info["stats"] = dict(self.stats)
            info["health"] = dict(self.health)
            try:
                self.cloud.heartbeat(info)
            except (TransientError, CloudError, InvalidResponse) as exc:
                log.info("heartbeat failed: %s", exc)
            self.stop.wait(60)

    def run(self, stop_file: Any = None) -> None:
        threads = [
            threading.Thread(target=self.vision_lane, name="vision-lane", daemon=True),
            threading.Thread(target=self.report_lane, name="report-lane", daemon=True),
            threading.Thread(target=self.hint_listener, name="hints", daemon=True),
            threading.Thread(target=self.heartbeat_loop, name="heartbeat", daemon=True),
        ]
        for t in threads:
            t.start()
        log.info("agent %s started: backend=%s vision=%s model=%s", __version__, self.config.backend_url, self.config.vision_url, self.config.summary_model)
        try:
            while not self.stop.wait(1):
                if stop_file is not None and stop_file.exists():
                    log.info("stop requested via %s", stop_file.name)
                    stop_file.unlink(missing_ok=True)
                    break
        except KeyboardInterrupt:
            log.info("interrupted")
        finally:
            self.stop.set()
            self.preempt.set()  # make a running report generation return promptly
            for t in threads:
                t.join(timeout=30)
            log.info("agent stopped: %s", self.stats)

    def run_once(self, kinds: tuple[str, ...] = ("vision", "daily_report"), max_jobs: int = 50) -> dict[str, int]:
        """Process what is queued now and return (used by tests and the integration harness)."""
        for _ in range(max_jobs):
            job = None
            if "vision" in kinds:
                job = self.cloud.claim(["vision"], self.config.lease_seconds, False)
                if job:
                    self.process_vision(job)
                    continue
            if "daily_report" in kinds:
                job = self.cloud.claim(["daily_report"], self.config.lease_seconds, True)
                if job:
                    self.process_report(job)
                    continue
            break
        return dict(self.stats)
