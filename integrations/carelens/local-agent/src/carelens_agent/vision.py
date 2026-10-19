"""Adapter for the local Vision package (carelens_models_v1_20261018, tools/fit_eps32_server/server.py).

Verified against the installed server code (2026-10-19):
  GET  /health            -> {"status": "ok", "fall_heads": 3, "drink": true}
  POST /v1/fall-check     16 or 24 frames  -> {score, window_logits, windows, threshold=null, alert=null, status="NOT_CALIBRATED", ...}
  POST /v1/object-check   1..24 frames     -> {label, evidence, status="UNCALIBRATED", detections, ...}
Body: application/octet-stream, repeated [uint32 LE length][JPEG], ≤ 4 900 000 bytes, frame ≤ 200 000 bytes.
Errors are JSON {"error", "status": "ERROR"} and mean "unknown", never "no fall".

A 40-frame capture is never sent whole: it is split into the overlapping 24-frame requests 0–23, 8–31,
16–39 and the outputs are combined at capture level (one observation, not three). Only numbers and
labels are kept: timings, echoed headers and detection boxes are dropped.

The server reuses one Ultralytics predictor that keeps the images of its last request
(predictor.dataset.im0, predictor.batch, predictor.results[*].orig_img; Ultralytics 8.3.253). The package
must not be modified, so after every job that used /v1/object-check the adapter sends one neutral gray
synthetic frame, which replaces those references. See `scrub()`.
"""
from __future__ import annotations

import base64
import http.client
import json
import math
import time
from typing import Any
from urllib.parse import urlparse

from .frames import InputRejected, pack, validate, window_plan, wipe

LIFT_CLUSTER_FRAMES = 4
_UNCALIBRATED = {"NOT_CALIBRATED", "UNCALIBRATED"}

# 160x120 uniform gray JPEG made with Pillow: no person, no room. Used only to overwrite predictor state.
NEUTRAL_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAB4AKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z"
)


class VisionUnavailable(Exception):
    """No answer (connection refused, timeout) or HTTP 5xx/503: retry later."""


class VisionRejected(Exception):
    """HTTP 4xx from the package: this input cannot be analysed (not retryable)."""


class VisionProtocolError(Exception):
    """A 200 answer that does not match the documented contract."""


class VisionClient:
    def __init__(self, url: str, timeout: float) -> None:
        p = urlparse(url)
        self.host, self.port, self.timeout = p.hostname or "127.0.0.1", p.port or 80, timeout

    def _call(self, method: str, path: str, body: bytearray | bytes | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
        conn = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            resp = conn.getresponse()
            raw = resp.read()
            status = resp.status
        except (OSError, http.client.HTTPException) as exc:
            raise VisionUnavailable(f"{path}: {type(exc).__name__}") from exc
        finally:
            conn.close()
        try:
            data = json.loads(raw)
        except ValueError:
            data = None
        if status >= 500:
            raise VisionUnavailable(f"{path}: HTTP {status}")
        if status != 200:
            err = data.get("error") if isinstance(data, dict) else None
            raise VisionRejected(f"{path}: HTTP {status} {str(err)[:200] if err else ''}".strip())
        if not isinstance(data, dict):
            raise VisionProtocolError(f"{path}: body is not a JSON object")
        if str(data.get("status", "")).upper() == "ERROR":
            raise VisionRejected(f"{path}: status ERROR")
        return data

    def health(self) -> dict[str, Any]:
        h = self._call("GET", "/health")
        if h.get("status") != "ok" or not isinstance(h.get("fall_heads"), int) or not isinstance(h.get("drink"), bool):
            raise VisionProtocolError("/health: unexpected body")
        return h

    def post(self, path: str, frames: list[memoryview]) -> dict[str, Any]:
        body = pack(frames)
        try:
            return self._call("POST", path, body, {"Content-Type": "application/octet-stream", "Content-Length": str(len(body))})
        finally:
            wipe(body)

    def scrub(self) -> bool:
        """Replace the predictor's retained images with one neutral synthetic frame (see module doc)."""
        try:
            self._call(
                "POST",
                "/v1/object-check",
                bytes(pack([memoryview(NEUTRAL_JPEG)])),
                {"Content-Type": "application/octet-stream"},
            )
            return True
        except (VisionUnavailable, VisionRejected, VisionProtocolError):
            return False


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_fall(data: dict[str, Any], expected_windows: int) -> dict[str, Any]:
    score, logits, windows = data.get("score"), data.get("window_logits"), data.get("windows")
    threshold, alert, status = data.get("threshold"), data.get("alert"), data.get("status")
    if not _finite(score) or not isinstance(windows, int) or windows != expected_windows:
        raise VisionProtocolError("fall-check: score/windows missing or unexpected")
    if not isinstance(logits, list) or not logits or not all(isinstance(h, list) and len(h) == windows and all(_finite(x) for x in h) for h in logits):
        raise VisionProtocolError("fall-check: window_logits malformed")
    if threshold is not None and not _finite(threshold):
        raise VisionProtocolError("fall-check: threshold malformed")
    if alert is not None and not isinstance(alert, bool):
        raise VisionProtocolError("fall-check: alert malformed")
    if not isinstance(status, str) or not status:
        raise VisionProtocolError("fall-check: status missing")
    # Recompute the package's own score definition as a consistency check: mean over heads of max window logit.
    expected = sum(max(h) for h in logits) / len(logits)
    if abs(expected - float(score)) > 1e-6:
        raise VisionProtocolError("fall-check: score is not mean(max window logit per head)")
    return {"score": float(score), "window_logits": [[float(x) for x in h] for h in logits], "windows": windows, "threshold": threshold, "alert": alert, "status": status}


_EVIDENCE_INT = ("frames", "cup_frames", "medicine_frames", "near_face_frames")


def parse_drink(data: dict[str, Any], frames: int) -> dict[str, Any]:
    label, evidence, status = data.get("label"), data.get("evidence"), data.get("status")
    if label not in ("uong_nuoc", "uong_thuoc", "khong") or not isinstance(evidence, dict) or not isinstance(status, str):
        raise VisionProtocolError("object-check: label/evidence/status malformed")
    out: dict[str, Any] = {}
    for k in _EVIDENCE_INT:
        if not isinstance(evidence.get(k), int):
            raise VisionProtocolError(f"object-check: evidence.{k} malformed")
        out[k] = evidence[k]
    if out["frames"] != frames:
        raise VisionProtocolError("object-check: evidence.frames does not match the request")
    lift = evidence.get("lift_frame")
    if lift is not None and (not isinstance(lift, int) or not 0 <= lift < frames):
        raise VisionProtocolError("object-check: lift_frame malformed")
    out["lift_frame"] = lift
    if not isinstance(evidence.get("cup_lifted_to_face"), bool):
        raise VisionProtocolError("object-check: cup_lifted_to_face malformed")
    out["cup_lifted_to_face"] = evidence["cup_lifted_to_face"]
    if "medicine_handled" in evidence:
        if not isinstance(evidence["medicine_handled"], bool):
            raise VisionProtocolError("object-check: medicine_handled malformed")
        out["medicine_handled"] = evidence["medicine_handled"]
    return {"label": label, "evidence": out, "status": status}


def cluster_lifts(frames: list[int]) -> list[int]:
    out: list[int] = []
    for f in sorted(set(frames)):
        if not out or f - out[-1] > LIFT_CLUSTER_FRAMES:
            out.append(f)
    return out


def aggregate_drink(requests: list[dict[str, Any]]) -> dict[str, Any]:
    """drink_capture_aggregate.v1 (identical to the backend's re-derivation). Combines per-request
    package labels; a blister handled in one request plus a lift in another is flagged for review and is
    NOT turned into uong_thuoc."""
    labels = [r["label"] for r in requests]
    label = "uong_thuoc" if "uong_thuoc" in labels else "uong_nuoc" if "uong_nuoc" in labels else "khong"
    handled = any(r["evidence"].get("medicine_handled") is True for r in requests)
    lifted = any(r["evidence"]["cup_lifted_to_face"] for r in requests)
    lifts = [r["frame_start"] + r["evidence"]["lift_frame"] for r in requests if r["evidence"]["lift_frame"] is not None]
    return {"aggregate_label": label, "cross_window_review": label != "uong_thuoc" and handled and lifted, "distinct_lift_frames": cluster_lifts(lifts)}


def analyze(payload: dict[str, Any], frames: list, client: VisionClient, package_version: str) -> tuple[dict[str, Any], dict[str, float]]:
    """Runs the Vision package on one capture. Returns (vision-result.v1 without idempotency_key, timings).
    Raises InputRejected (corrupt media), VisionUnavailable (retry), VisionRejected/VisionProtocolError."""
    validation = validate(payload, frames)
    offsets = [int(m["t_offset_ms"]) for m in payload["frames"]]
    plan = window_plan(int(payload["frame_count"]))
    health = client.health()
    timings: dict[str, float] = {}
    result: dict[str, Any] = {
        "schema_version": "vision-result.v1",
        "capture_id": payload["capture_id"],
        "package_version": package_version,
        "vision_health": {"fall_heads": health["fall_heads"], "drink": health["drink"]},
        "input_validation": validation.as_dict(),
    }
    skip = "cadence_gap" if validation.cadence_status == "gap" else None
    checks = payload.get("checks", ["fall", "drink"])
    used_object_check = False
    try:
        # ---- fall
        if skip or "fall" not in checks or health["fall_heads"] == 0:
            reason = skip or ("not_requested" if "fall" not in checks else "fall_check_not_loaded")
            result["fall"] = {"status": "skipped", "reason": reason, "aggregation": None, "aggregate_score": None, "requests": []}
        else:
            reqs = []
            t0 = time.perf_counter()
            for s, e in plan:
                parsed = parse_fall(client.post("/v1/fall-check", frames[s : e + 1]), expected_windows=2)
                reqs.append({"frame_start": s, "frame_end": e, "t_start_ms": offsets[s], "t_end_ms": offsets[e], **parsed})
            timings["fall_ms"] = (time.perf_counter() - t0) * 1000
            result["fall"] = {
                "status": "completed",
                "reason": None,
                "aggregation": "single_request.v1" if len(plan) == 1 else "max_request_score_overlapping.v1",
                "aggregate_score": max(r["score"] for r in reqs),
                "requests": reqs,
            }
        # ---- drink / medicine
        if skip or "drink" not in checks or not health["drink"]:
            reason = skip or ("not_requested" if "drink" not in checks else "object_check_not_loaded")
            result["drink"] = {"status": "skipped", "reason": reason, "aggregation": None, "aggregate_label": None, "cross_window_review": False, "distinct_lift_frames": [], "requests": []}
        else:
            reqs = []
            t0 = time.perf_counter()
            for s, e in plan:
                used_object_check = True
                parsed = parse_drink(client.post("/v1/object-check", frames[s : e + 1]), frames=e - s + 1)
                reqs.append({"frame_start": s, "frame_end": e, "t_start_ms": offsets[s], "t_end_ms": offsets[e], **parsed})
            timings["drink_ms"] = (time.perf_counter() - t0) * 1000
            result["drink"] = {"status": "completed", "reason": None, "aggregation": "drink_capture_aggregate.v1", **aggregate_drink(reqs), "requests": reqs}
    finally:
        if used_object_check:
            timings["scrubbed"] = 1.0 if client.scrub() else 0.0
    return result, timings


__all__ = ["InputRejected", "VisionClient", "VisionProtocolError", "VisionRejected", "VisionUnavailable", "aggregate_drink", "analyze", "cluster_lifts", "parse_drink", "parse_fall"]
