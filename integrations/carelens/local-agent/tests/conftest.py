"""Test doubles for the agent: fake Vision API, fake Ollama and fake backend on loopback HTTP servers.

All data is synthetic: frames are uniform gray JPEGs (no people), scores and labels are made up and carry
no clinical meaning. The real-package end-to-end test lives in tests/integration and is opt-in.
"""
from __future__ import annotations

import base64
import hashlib
import json
import struct
import sys
import threading
import time
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from carelens_agent.vision import NEUTRAL_JPEG  # noqa: E402

GRAY = NEUTRAL_JPEG  # 160x120


def frame(i: int) -> bytes:
    """Distinct valid JPEG per index (COM segment after SOI)."""
    text = f"test-frame-{i}".encode()
    com = b"\xff\xfe" + struct.pack(">H", len(text) + 2) + text
    return GRAY[:2] + com + GRAY[2:]


def pack(frames: list[bytes]) -> bytes:
    return b"".join(struct.pack("<I", len(f)) + f for f in frames)


def unpack(body: bytes) -> list[bytes]:
    out, i = [], 0
    while i < len(body):
        (n,) = struct.unpack_from("<I", body, i)
        out.append(body[i + 4 : i + 4 + n])
        i += 4 + n
    return out


def payload(count: int = 24, offsets: list[int] | None = None, capture_id: str = "cap-test", per_chunk: int = 8) -> tuple[dict[str, Any], list[bytes]]:
    frames = [frame(i) for i in range(count)]
    offsets = offsets or [i * 125 for i in range(count)]
    chunks = (count + per_chunk - 1) // per_chunk
    p = {
        "capture_id": capture_id,
        "mode": "normal" if count == 24 else "triggered",
        "frame_count": count,
        "frame_width": 160,
        "frame_height": 120,
        "frames": [{"seq": i, "t_offset_ms": offsets[i], "size_bytes": len(f), "sha256": hashlib.sha256(f).hexdigest()} for i, f in enumerate(frames)],
        "cadence_tolerance_ms": 40,
        "checks": ["fall", "drink"],
        "frames_per_chunk": per_chunk,
        "chunk_count": chunks,
        "media": [{"chunk_index": c, "path": f"/media/{c}", "frame_start": c * per_chunk, "frame_end": min(count, (c + 1) * per_chunk) - 1} for c in range(chunks)],
    }
    return p, frames


class _QuietServer(ThreadingHTTPServer):
    def handle_error(self, request: Any, client_address: Any) -> None:
        pass  # clients that abort on purpose (cancellation tests) are expected


class _Server:
    def __init__(self, handler_factory: Callable[[], type[BaseHTTPRequestHandler]]) -> None:
        self.httpd = _QuietServer(("127.0.0.1", 0), handler_factory())
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


class FakeVision:
    """Mimics tools/fit_eps32_server/server.py. Fall score is derived from the first frame index so tests
    can tell which frames a request carried; mode switches inject failures."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.mode = "ok"  # ok | http500 | http400 | slow | malformed | down_after_health
        self.drink_labels: list[dict[str, Any]] = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a: Any) -> None:
                pass

            def reply(self, code: int, value: Any) -> None:
                data = json.dumps(value).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:
                if self.path == "/health":
                    self.reply(200, {"status": "ok", "fall_heads": 3, "drink": True})
                else:
                    self.reply(404, {"error": "not found"})

            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers["Content-Length"]))
                frames = unpack(body)
                first = frames[0].split(b"test-frame-")[1][:2].rstrip(b"\xff\xdb\x00") if b"test-frame-" in frames[0] else b"neutral"
                outer.calls.append({"path": self.path, "count": len(frames), "first": first.decode(errors="replace"), "content_type": self.headers.get("Content-Type")})
                if outer.mode == "http500":
                    return self.reply(500, {"error": "internal error", "status": "ERROR"})
                if outer.mode == "http400":
                    return self.reply(400, {"error": "expected [16, 24] frames", "status": "ERROR"})
                if outer.mode == "slow":
                    time.sleep(2)
                if outer.mode == "malformed":
                    return self.reply(200, {"score": "high"})
                if self.path == "/v1/fall-check":
                    if len(frames) not in (16, 24):
                        return self.reply(400, {"error": f"expected [16, 24] frames, got {len(frames)}", "status": "ERROR"})
                    start = int(first) if first.isdigit() else 0
                    logits = [[-2.0 + start / 10, -1.0 + start / 10] for _ in range(3)]
                    score = sum(max(h) for h in logits) / 3
                    return self.reply(200, {"score": score, "window_logits": logits, "windows": 2, "threshold": None, "alert": None, "status": "NOT_CALIBRATED", "ms": {"total": 1.0}, "device_id": None, "trigger_ms": None, "server_ms": 2.0, "utc": "2026-10-19T00:00:00+00:00"})
                if self.path == "/v1/object-check":
                    if not 1 <= len(frames) <= 24:
                        return self.reply(400, {"error": "bad count", "status": "ERROR"})
                    idx = len([c for c in outer.calls if c["path"] == "/v1/object-check" and c["count"] > 1]) - 1
                    preset = outer.drink_labels[idx] if 0 <= idx < len(outer.drink_labels) and len(frames) > 1 else {}
                    evidence = {"frames": len(frames), "cup_frames": 0, "medicine_frames": 0, "near_face_frames": 0, "lift_frame": None, "cup_lifted_to_face": False, "medicine_handled": False, **preset.get("evidence", {})}
                    return self.reply(200, {"label": preset.get("label", "khong"), "evidence": evidence, "status": "UNCALIBRATED", "detections": [[{"cls": 0, "conf": 0.5, "xyxyn": [0, 0, 1, 1]}]], "ms": 3.0})
                self.reply(404, {"error": "not found"})

        self.server = _Server(lambda: H)
        self.url = self.server.url


class FakeOllama:
    def __init__(self) -> None:
        self.outputs: list[str] = []
        self.requests: list[dict[str, Any]] = []
        self.delay_per_chunk = 0.0
        self.installed = True
        outer = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a: Any) -> None:
                pass

            def do_GET(self) -> None:
                models = [{"name": "qwen3:4b-instruct-2507-q4_K_M", "model": "qwen3:4b-instruct-2507-q4_K_M", "digest": "0edcdef34593" + "0" * 52}] if outer.installed else []
                data = json.dumps({"models": models}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self) -> None:
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append(req)
                text = outer.outputs.pop(0) if outer.outputs else "{}"
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                try:
                    pieces = [text[i : i + 40] for i in range(0, len(text), 40)] or [""]
                    for p in pieces:
                        self._chunk(json.dumps({"message": {"role": "assistant", "content": p}, "done": False}) + "\n")
                        time.sleep(outer.delay_per_chunk)
                    self._chunk(json.dumps({"message": {"role": "assistant", "content": ""}, "done": True, "eval_count": 42, "prompt_eval_count": 300, "total_duration": 1_500_000_000}) + "\n")
                    self.wfile.write(b"0\r\n\r\n")
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass

            def _chunk(self, s: str) -> None:
                b = s.encode()
                self.wfile.write(f"{len(b):x}\r\n".encode() + b + b"\r\n")
                self.wfile.flush()

        self.server = _Server(lambda: H)
        self.url = self.server.url


class FakeBackend:
    """In-memory stand-in for the agent API: queue of jobs, media chunks, recorded completions."""

    def __init__(self) -> None:
        self.jobs: list[dict[str, Any]] = []
        self.media: dict[tuple[str, int], bytes] = {}
        self.completions: list[tuple[str, dict[str, Any]]] = []
        self.failures: list[tuple[str, dict[str, Any]]] = []
        self.releases: list[tuple[str, dict[str, Any]]] = []
        self.claims: list[dict[str, Any]] = []
        self.fail_next: list[int] = []  # status codes to return for upcoming complete calls
        self.hint_frames: list[str] = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a: Any) -> None:
                pass

            def reply(self, code: int, value: Any, ctype: str = "application/json") -> None:
                data = value if isinstance(value, bytes) else json.dumps(value).encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _auth(self) -> bool:
                if self.headers.get("Authorization") != "Bearer cla_test-agent-token-0123456789":
                    self.reply(401, {"code": "invalid_credential"})
                    return False
                return True

            def do_GET(self) -> None:
                if not self._auth():
                    return
                if self.path == "/ready":
                    return self.reply(200, {"status": "ready"})
                if self.path == "/api/agent/v1/events":
                    body = "".join(outer.hint_frames).encode()
                    return self.reply(200, body, "text/event-stream")
                parts = self.path.split("/")
                if "media" in parts:
                    key = (parts[5], int(parts[7]))
                    if key not in outer.media:
                        return self.reply(410, {"code": "media_deleted"})
                    return self.reply(200, outer.media[key], "application/octet-stream")
                self.reply(404, {"code": "not_found"})

            def do_POST(self) -> None:
                if not self._auth():
                    return
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0") or 0)) or b"{}")
                if self.path == "/api/agent/v1/jobs/claim":
                    outer.claims.append(body)
                    for job in outer.jobs:
                        if job["kind"] in body["kinds"] and not job.get("taken"):
                            job["taken"] = True
                            return self.reply(200, {"job": {k: v for k, v in job.items() if k != "taken"}, "vision_backlog": 0})
                    return self.reply(200, {"job": None, "vision_backlog": 0})
                if self.path == "/api/agent/v1/heartbeat":
                    return self.reply(200, {"server_time": "x"})
                job_id = self.path.split("/")[5]
                if self.path.endswith("/complete"):
                    if outer.fail_next:
                        return self.reply(outer.fail_next.pop(0), {"code": "unavailable"})
                    if any(j == job_id and r["idempotency_key"] == body["idempotency_key"] for j, r in outer.completions):
                        return self.reply(200, {"status": "completed", "duplicate": True})
                    outer.completions.append((job_id, body))
                    return self.reply(200, {"status": "completed", "duplicate": False, "decision_ids": [], "alert_ids": [], "media_deleted": True})
                if self.path.endswith("/fail"):
                    outer.failures.append((job_id, body))
                    return self.reply(200, {"status": "failed" if not body["retryable"] else "retry_pending"})
                if self.path.endswith("/release"):
                    outer.releases.append((job_id, body))
                    for job in outer.jobs:
                        if job["job_id"] == job_id:
                            job["taken"] = False
                    return self.reply(200, {"status": "queued"})
                if self.path.endswith("/lease"):
                    return self.reply(200, {"lease_expires_at": "x"})
                self.reply(404, {"code": "not_found"})

        self.server = _Server(lambda: H)
        self.url = self.server.url

    def add_vision_job(self, job_id: str, count: int = 24) -> list[bytes]:
        p, frames = payload(count, capture_id=f"cap-{job_id}")
        for m in p["media"]:
            self.media[(job_id, m["chunk_index"])] = pack(frames[m["frame_start"] : m["frame_end"] + 1])
        self.jobs.append({"job_id": job_id, "kind": "vision", "priority": 50, "attempt": 1, "max_attempts": 3, "lease_token": f"lease_{job_id}-0123456789", "payload": p})
        return frames

    def add_report_job(self, job_id: str, inp: dict[str, Any]) -> None:
        self.jobs.append({"job_id": job_id, "kind": "daily_report", "priority": 10, "attempt": 1, "max_attempts": 6, "lease_token": f"lease_{job_id}-0123456789", "payload": {"report_id": "rpt_1", "input": inp, "input_snapshot_sha256": "a" * 64}})


AGENT_TOKEN = "cla_test-agent-token-0123456789"


def report_input() -> dict[str, Any]:
    return {
        "schema_version": "daily-report-input.v1",
        "report_date": "2026-10-18",
        "timezone": "Asia/Ho_Chi_Minh",
        "period_start": "2026-10-17T17:00:00.000Z",
        "period_end": "2026-10-18T17:00:00.000Z",
        "model_status": {"fall_check": "NOT_CALIBRATED", "drink_check": "UNCALIBRATED"},
        "stats": {"fall_decisions": {"total": 2, "unverified": 1}, "coverage": {"hours_in_day": 24, "hours_with_device_contact": 21}},
        "notable_events": [
            {"event_id": "fdc_1", "kind": "fall_decision", "time_local": "08:15", "status": "needs_review", "verification_status": "unverified"},
            {"event_id": "evt_2", "kind": "drink_observation", "time_local": "09:40", "status": "drinking_water_observed", "verification_status": "verified"},
        ],
        "notable_events_truncated": False,
        "data_gaps": [{"gap_id": "g1", "from_local": "02:00", "to_local": "05:00", "hours": 3}],
        "rules": [],
    }


def good_report() -> dict[str, Any]:
    return {
        "schema_version": "daily-report-llm.v1",
        "summary_vi": "Ngày 18/10/2026 có 2 quyết định nghi ngã, 1 chưa xác minh (lúc 08:15). Thiếu dữ liệu 02:00–05:00.",
        "notable_events": [{"event_id": "fdc_1", "note_vi": "Cần xem lại."}],
        "unverified_items": [{"event_id": "fdc_1", "note_vi": "Chưa được xác minh."}],
        "data_gaps": [{"gap_id": "g1", "note_vi": "Không có liên lạc thiết bị."}],
        "source_event_ids": ["fdc_1"],
    }


@pytest.fixture
def vision() -> Iterator[FakeVision]:
    v = FakeVision()
    yield v
    v.server.close()


@pytest.fixture
def ollama() -> Iterator[FakeOllama]:
    o = FakeOllama()
    yield o
    o.server.close()


@pytest.fixture
def backend() -> Iterator[FakeBackend]:
    b = FakeBackend()
    yield b
    b.server.close()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()
