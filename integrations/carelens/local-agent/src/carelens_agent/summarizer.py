"""Daily report generation with the local Ollama runtime (Qwen3, Module 2).

The backend computes every count; the model only writes a Vietnamese summary that must cite input ids.
The output is requested as JSON Schema structured output, then validated here exactly like the backend
does (ids, gaps, no numbers absent from the input). Generation streams, so an urgent vision job can
cancel it between chunks (`cancel` event). A report is only submitted after a real generation call; the
runtime's own counters (eval_count, durations) are forwarded as evidence.
"""
from __future__ import annotations

import http.client
import json
import re
import threading
from typing import Any
from urllib.parse import urlparse

REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["schema_version", "summary_vi", "notable_events", "unverified_items", "data_gaps", "source_event_ids"],
    "properties": {
        "schema_version": {"type": "string", "enum": ["daily-report-llm.v1"]},
        "summary_vi": {"type": "string", "minLength": 1, "maxLength": 2000},
        "notable_events": {"type": "array", "maxItems": 40, "items": {"type": "object", "additionalProperties": False, "required": ["event_id", "note_vi"], "properties": {"event_id": {"type": "string"}, "note_vi": {"type": "string", "minLength": 1, "maxLength": 300}}}},
        "unverified_items": {"type": "array", "maxItems": 40, "items": {"type": "object", "additionalProperties": False, "required": ["event_id", "note_vi"], "properties": {"event_id": {"type": "string"}, "note_vi": {"type": "string", "minLength": 1, "maxLength": 300}}}},
        "data_gaps": {"type": "array", "maxItems": 24, "items": {"type": "object", "additionalProperties": False, "required": ["gap_id", "note_vi"], "properties": {"gap_id": {"type": "string"}, "note_vi": {"type": "string", "minLength": 1, "maxLength": 300}}}},
        "source_event_ids": {"type": "array", "maxItems": 200, "items": {"type": "string"}},
    },
}

SYSTEM_PROMPT = """Bạn viết báo cáo chăm sóc hằng ngày bằng tiếng Việt cho người chăm sóc người cao tuổi.
Chỉ dùng dữ liệu trong INPUT. Quy tắc bắt buộc:
- Mọi con số bạn viết phải có sẵn trong INPUT (stats, giờ, ngày). Không tự cộng, không ước lượng, không suy ra số mới.
- Nhận định AI là CHƯA được con người xác nhận. Không gọi "nghi ngã" là "đã ngã". Mô hình ngã chưa hiệu chỉnh thì nói rõ là chưa kết luận được.
- Không chẩn đoán, không khuyên dùng thuốc hay điều trị.
- Khoảng không có liên lạc thiết bị là THIẾU DỮ LIỆU, không phải bình thường hay an toàn.
- Chỉ trích dẫn event_id có trong INPUT.notable_events và gap_id có trong INPUT.data_gaps.
- unverified_items chỉ gồm các sự kiện có verification_status = "unverified".
- Mọi event_id nêu trong notable_events hoặc unverified_items phải có trong source_event_ids.
Trả về đúng một đối tượng JSON theo schema, schema_version = "daily-report-llm.v1"."""


class OllamaUnavailable(Exception):
    pass


class GenerationCancelled(Exception):
    pass


class ReportInvalid(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def _numbers(value: Any, out: set[int]) -> None:
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        out.add(abs(int(value)))
    elif isinstance(value, str):
        out.update(int(m) for m in re.findall(r"\d+", value))
    elif isinstance(value, list):
        for v in value:
            _numbers(v, out)
    elif isinstance(value, dict):
        for v in value.values():
            _numbers(v, out)


def validate_report(report: Any, inp: dict[str, Any]) -> list[str]:
    """Same rules as the backend (reports.ts validateReportOutput) plus structural checks."""
    if not isinstance(report, dict):
        return ["output is not a JSON object"]
    problems: list[str] = []
    required = REPORT_SCHEMA["required"]
    extra = set(report) - set(required)
    missing = [k for k in required if k not in report]
    if missing:
        problems.append(f"missing fields: {', '.join(missing)}")
    if extra:
        problems.append(f"unexpected fields: {', '.join(sorted(extra))}")
    if problems:
        return problems
    if report["schema_version"] != "daily-report-llm.v1":
        problems.append("schema_version must be daily-report-llm.v1")
    if not isinstance(report["summary_vi"], str) or not report["summary_vi"].strip() or len(report["summary_vi"]) > 2000:
        problems.append("summary_vi must be a non-empty string of at most 2000 characters")
    for key, idk in (("notable_events", "event_id"), ("unverified_items", "event_id"), ("data_gaps", "gap_id")):
        items = report[key]
        if not isinstance(items, list) or not all(isinstance(i, dict) and set(i) == {idk, "note_vi"} and isinstance(i[idk], str) and isinstance(i["note_vi"], str) and 0 < len(i["note_vi"]) <= 300 for i in items):
            problems.append(f"{key} items must be objects {{{idk}, note_vi}}")
    if not isinstance(report["source_event_ids"], list) or not all(isinstance(i, str) for i in report["source_event_ids"]):
        problems.append("source_event_ids must be a list of strings")
    if problems:
        return problems
    event_ids = {str(e["event_id"]) for e in inp["notable_events"]}
    unverified = {str(e["event_id"]) for e in inp["notable_events"] if e.get("verification_status") == "unverified"}
    gap_ids = {g["gap_id"] for g in inp["data_gaps"]}
    for i in report["source_event_ids"]:
        if i not in event_ids:
            problems.append(f"unknown source_event_id {i}")
    for n in report["notable_events"]:
        if n["event_id"] not in event_ids:
            problems.append(f"unknown notable event {n['event_id']}")
    for n in report["unverified_items"]:
        if n["event_id"] not in unverified:
            problems.append(f"unverified_items lists {n['event_id']}, which is not an unverified input event")
    for g in report["data_gaps"]:
        if g["gap_id"] not in gap_ids:
            problems.append(f"unknown gap {g['gap_id']}")
    for i in {n["event_id"] for n in report["notable_events"] + report["unverified_items"]}:
        if i not in report["source_event_ids"]:
            problems.append(f"event {i} is cited but missing from source_event_ids")
    allowed: set[int] = {0, 24}
    _numbers(inp["stats"], allowed)
    _numbers(inp["data_gaps"], allowed)
    _numbers([e.get("time_local") for e in inp["notable_events"]], allowed)
    _numbers(inp["report_date"], allowed)
    _numbers([int(x) for x in inp["report_date"].split("-")], allowed)
    stated: set[int] = set()
    _numbers([report["summary_vi"]] + [n["note_vi"] for n in report["notable_events"] + report["unverified_items"] + report["data_gaps"]], stated)
    unknown = sorted(stated - allowed)
    if unknown:
        problems.append(f"numbers not present in the input: {', '.join(map(str, unknown[:10]))}")
    return problems


def compact_input(inp: dict[str, Any]) -> dict[str, Any]:
    """The part of the backend snapshot the model needs (no period instants, no ids it cannot cite)."""
    return {
        "report_date": inp["report_date"],
        "timezone": inp["timezone"],
        "model_status": inp["model_status"],
        "stats": inp["stats"],
        "notable_events": inp["notable_events"],
        "notable_events_truncated": inp["notable_events_truncated"],
        "data_gaps": inp["data_gaps"],
    }


class OllamaClient:
    def __init__(self, url: str, model: str, timeout: float, keep_alive: str, num_ctx: int) -> None:
        p = urlparse(url)
        self.host, self.port = p.hostname or "127.0.0.1", p.port or 11434
        self.model, self.timeout, self.keep_alive, self.num_ctx = model, timeout, keep_alive, num_ctx
        self._active: http.client.HTTPConnection | None = None
        self._lock = threading.Lock()

    def abort(self) -> None:
        """Called from another thread: cut the in-flight generation so the GPU is released promptly."""
        import socket

        with self._lock:
            conn = self._active
        if conn is not None and conn.sock is not None:
            try:
                conn.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def _conn(self, timeout: float) -> http.client.HTTPConnection:
        return http.client.HTTPConnection(self.host, self.port, timeout=timeout)

    def model_digest(self) -> str:
        conn = self._conn(10)
        try:
            conn.request("GET", "/api/tags")
            resp = conn.getresponse()
            data = json.loads(resp.read())
        except (OSError, http.client.HTTPException, ValueError) as exc:
            raise OllamaUnavailable(f"/api/tags: {type(exc).__name__}") from exc
        finally:
            conn.close()
        for m in data.get("models", []) if isinstance(data, dict) else []:
            if m.get("name") == self.model or m.get("model") == self.model:
                return str(m.get("digest", ""))[:64] or "unknown"
        raise OllamaUnavailable(f"model {self.model} is not installed in Ollama")

    def chat(self, messages: list[dict[str, str]], cancel: threading.Event | None) -> tuple[str, dict[str, Any]]:
        body = json.dumps({
            "model": self.model,
            "messages": messages,
            "stream": True,
            "format": REPORT_SCHEMA,
            "keep_alive": self.keep_alive,
            "options": {"temperature": 0, "num_ctx": self.num_ctx, "seed": 7},
        }).encode("utf-8")
        conn = self._conn(self.timeout)
        parts: list[str] = []
        final: dict[str, Any] = {}
        with self._lock:
            self._active = conn
        try:
            conn.request("POST", "/api/chat", body=body, headers={"Content-Type": "application/json"})
            resp = conn.getresponse()
            if resp.status != 200:
                resp.read()
                raise OllamaUnavailable(f"/api/chat HTTP {resp.status}")
            while True:
                if cancel is not None and cancel.is_set():
                    raise GenerationCancelled()
                line = resp.readline()
                if not line:
                    break
                try:
                    chunk = json.loads(line)
                except ValueError:
                    continue
                if "error" in chunk:
                    raise OllamaUnavailable(f"/api/chat error: {str(chunk['error'])[:200]}")
                parts.append(chunk.get("message", {}).get("content", ""))
                if chunk.get("done"):
                    final = chunk
                    break
        except (OSError, http.client.HTTPException) as exc:
            if cancel is not None and cancel.is_set():
                raise GenerationCancelled() from exc
            raise OllamaUnavailable(f"/api/chat: {type(exc).__name__}") from exc
        finally:
            with self._lock:
                self._active = None
            conn.close()  # closing the connection also stops a cancelled generation in Ollama
        if not final:
            raise OllamaUnavailable("/api/chat ended without a final chunk")
        stats = {
            "eval_count": int(final.get("eval_count", 0)),
            "prompt_eval_count": int(final.get("prompt_eval_count", 0)),
            "total_duration_ms": round(float(final.get("total_duration", 0)) / 1e6, 1),
        }
        return "".join(parts), stats


def generate_report(client: OllamaClient, job_payload: dict[str, Any], cancel: threading.Event | None, max_attempts: int = 2) -> dict[str, Any]:
    """Returns a daily-report-result.v1 (without idempotency_key). Raises ReportInvalid, OllamaUnavailable,
    GenerationCancelled."""
    inp = job_payload["input"]
    digest = client.model_digest()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "INPUT:\n" + json.dumps(compact_input(inp), ensure_ascii=False, separators=(",", ":"))},
    ]
    totals = {"eval_count": 0, "prompt_eval_count": 0, "total_duration_ms": 0.0}
    problems: list[str] = []
    for attempt in range(1, max_attempts + 1):
        text, stats = client.chat(messages, cancel)
        for k in totals:
            totals[k] += stats[k]
        try:
            report = json.loads(text)
        except ValueError:
            report = None
            problems = ["output is not valid JSON"]
        else:
            problems = validate_report(report, inp)
        if not problems and stats["eval_count"] > 0:
            return {
                "schema_version": "daily-report-result.v1",
                "input_snapshot_sha256": job_payload["input_snapshot_sha256"],
                "report": report,
                "model": {"name": client.model, "digest": digest, "runtime": "ollama"},
                "inference": {"eval_count": int(totals["eval_count"]), "prompt_eval_count": int(totals["prompt_eval_count"]), "total_duration_ms": round(totals["total_duration_ms"], 1), "attempts": attempt},
            }
        messages = messages[:2] + [
            {"role": "assistant", "content": text[:4000]},
            {"role": "user", "content": "Đầu ra chưa hợp lệ: " + "; ".join(problems[:8]) + ". Hãy trả lại JSON đúng quy tắc, chỉ dùng số và id có trong INPUT."},
        ]
    raise ReportInvalid(problems)
