"""Client for the care-monitoring backend's agent API. Outbound HTTPS only; no inbound port is needed.

Every call has a bounded timeout. Transient failures (network errors, 5xx, 429) raise TransientError so
callers can back off and retry; result submission retries reuse the same idempotency key, so a retry
after a lost response can never create a second set of events.
"""
from __future__ import annotations

import http.client
import json
import logging
import random
import socket
import ssl
import threading
import time
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlparse

from . import __version__

log = logging.getLogger("carelens_agent")


class CloudError(Exception):
    """The backend answered with a definitive error (4xx other than 429)."""

    def __init__(self, status: int, code: str, detail: str = "") -> None:
        super().__init__(f"{status} {code}")
        self.status, self.code, self.detail = status, code, detail


class TransientError(Exception):
    """Network error, timeout, 5xx or 429: retry later."""


class InvalidResponse(Exception):
    """The backend answered 2xx with a body that does not match the protocol."""


def backoff_delays(base: float = 1.0, cap: float = 60.0) -> Iterator[float]:
    """1, 2, 4 … cap seconds with ±20 % jitter."""
    delay = base
    while True:
        yield delay * random.uniform(0.8, 1.2)
        delay = min(cap, delay * 2)


class CloudClient:
    def __init__(self, base_url: str, token: str, timeout: float) -> None:
        parsed = urlparse(base_url)
        self._https = parsed.scheme == "https"
        self._host = parsed.hostname or ""
        self._port = parsed.port or (443 if self._https else 80)
        self._prefix = parsed.path.rstrip("/")
        self._token = token
        self.timeout = timeout
        self._ssl = ssl.create_default_context() if self._https else None

    def __repr__(self) -> str:
        return f"CloudClient({self._host}:{self._port})"

    def _conn(self, timeout: float) -> http.client.HTTPConnection:
        if self._https:
            return http.client.HTTPSConnection(self._host, self._port, timeout=timeout, context=self._ssl)
        return http.client.HTTPConnection(self._host, self._port, timeout=timeout)

    def request(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None, raw: bool = False, timeout: float | None = None) -> tuple[int, Any]:
        hdrs = {"Authorization": f"Bearer {self._token}", "User-Agent": f"carelens-local-agent/{__version__}", **(headers or {})}
        data: bytes | None = None
        if body is not None:
            data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        conn = self._conn(timeout or self.timeout)
        try:
            conn.request(method, self._prefix + path, body=data, headers=hdrs)
            resp = conn.getresponse()
            payload = resp.read()
            status = resp.status
        except (OSError, http.client.HTTPException) as exc:
            raise TransientError(f"{method} {path}: {type(exc).__name__}") from exc
        finally:
            conn.close()
        if status == 429 or status >= 500:
            raise TransientError(f"{method} {path}: HTTP {status}")
        if status >= 400:
            code, detail = "http_error", ""
            try:
                problem = json.loads(payload)
                code, detail = str(problem.get("code", code)), str(problem.get("detail", ""))[:300]
            except (ValueError, AttributeError):
                pass
            raise CloudError(status, code, detail)
        if raw:
            return status, payload
        if status == 204 or not payload:
            return status, None
        try:
            return status, json.loads(payload)
        except ValueError as exc:
            raise InvalidResponse(f"{method} {path}: body is not JSON") from exc

    # ------------------------------------------------------------------ protocol

    def claim(self, kinds: list[str], lease_seconds: int, defer_if_vision_pending: bool) -> dict[str, Any] | None:
        _, body = self.request("POST", "/api/agent/v1/jobs/claim", {"kinds": kinds, "lease_seconds": lease_seconds, "defer_if_vision_pending": defer_if_vision_pending})
        if not isinstance(body, dict) or "job" not in body:
            raise InvalidResponse("claim: missing 'job'")
        job = body["job"]
        if job is None:
            return None
        required = {"job_id": str, "kind": str, "lease_token": str, "attempt": int, "payload": dict}
        for key, kind in required.items():
            if not isinstance(job.get(key), kind):
                raise InvalidResponse(f"claim: job.{key} missing or wrong type")
        if job["kind"] not in kinds:
            raise InvalidResponse(f"claim: unexpected job kind {job['kind']!r}")
        return job

    def media(self, job_id: str, index: int, lease_token: str) -> bytearray:
        _, payload = self.request("GET", f"/api/agent/v1/jobs/{job_id}/media/{index}", headers={"X-Lease-Token": lease_token}, raw=True, timeout=max(self.timeout, 30))
        return bytearray(payload)

    def renew(self, job_id: str, lease_token: str, seconds: int) -> None:
        self.request("POST", f"/api/agent/v1/jobs/{job_id}/lease", {"lease_token": lease_token, "lease_seconds": seconds})

    def release(self, job_id: str, lease_token: str, reason: str) -> None:
        self.request("POST", f"/api/agent/v1/jobs/{job_id}/release", {"lease_token": lease_token, "reason": reason})

    def fail(self, job_id: str, lease_token: str, code: str, retryable: bool, detail: str | None = None) -> str:
        _, body = self.request("POST", f"/api/agent/v1/jobs/{job_id}/fail", {"lease_token": lease_token, "error_code": code, "retryable": retryable, "detail": (detail or None) and detail[:500]})
        return str((body or {}).get("status", ""))

    def complete(self, job_id: str, lease_token: str, result: dict[str, Any], attempts: int = 5, stop: threading.Event | None = None) -> dict[str, Any]:
        """Submits a result, retrying transient failures with the same idempotency key."""
        delays = backoff_delays(1.0, 20.0)
        for attempt in range(1, attempts + 1):
            try:
                _, body = self.request("POST", f"/api/agent/v1/jobs/{job_id}/complete", result, headers={"X-Lease-Token": lease_token}, timeout=max(self.timeout, 30))
                return body if isinstance(body, dict) else {}
            except TransientError as exc:
                if attempt == attempts:
                    raise
                wait = next(delays)
                log.warning("complete %s: transient failure (%s); retry %d in %.1fs", job_id, exc, attempt, wait)
                if stop is not None and stop.wait(wait):
                    raise
                if stop is None:
                    time.sleep(wait)
        raise TransientError("unreachable")

    def heartbeat(self, info: dict[str, Any]) -> None:
        self.request("POST", "/api/agent/v1/heartbeat", info)

    def hints(self, stop: threading.Event, read_timeout: float = 45.0) -> Iterator[dict[str, Any]]:
        """Yields job hints from the SSE stream until it ends. Keepalives arrive every 15 s, so a read
        timeout means the connection is dead. Raises TransientError on connection problems."""
        conn = self._conn(read_timeout)
        try:
            conn.request("GET", self._prefix + "/api/agent/v1/events", headers={"Authorization": f"Bearer {self._token}", "Accept": "text/event-stream"})
            resp = conn.getresponse()
            if resp.status != 200:
                resp.read()
                if resp.status in (401, 403):
                    raise CloudError(resp.status, "unauthorized")
                raise TransientError(f"hint stream HTTP {resp.status}")
            data_lines: list[str] = []
            while not stop.is_set():
                line = resp.readline()
                if not line:
                    return
                text = line.decode("utf-8", "replace").rstrip("\r\n")
                if text == "":
                    if data_lines:
                        try:
                            msg = json.loads("\n".join(data_lines))
                            if isinstance(msg, dict):
                                yield msg
                        except ValueError:
                            log.warning("hint stream: ignored a malformed frame")
                        data_lines = []
                elif text.startswith("data:"):
                    data_lines.append(text[5:].lstrip())
        except (OSError, http.client.HTTPException, socket.timeout) as exc:
            raise TransientError(f"hint stream: {type(exc).__name__}") from exc
        finally:
            conn.close()
