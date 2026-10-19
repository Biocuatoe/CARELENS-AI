"""Config safety, cloud protocol and retries, LLM summarization, job processing, priority and preemption."""
from __future__ import annotations

import json
import threading
import time

import pytest
from conftest import AGENT_TOKEN, FakeBackend, FakeOllama, FakeVision, good_report, report_input

from carelens_agent.cloud import CloudClient, CloudError, InvalidResponse, TransientError
from carelens_agent.config import AgentConfig, ConfigError
from carelens_agent.logs import RedactingFilter
from carelens_agent.runner import Agent
from carelens_agent.summarizer import GenerationCancelled, OllamaClient, OllamaUnavailable, ReportInvalid, generate_report, validate_report


def config(backend: str, vision: str = "http://127.0.0.1:9", ollama: str = "http://127.0.0.1:9", **extra: str) -> AgentConfig:
    env = {"CARELENS_BACKEND_URL": backend, "CARELENS_AGENT_TOKEN": AGENT_TOKEN, "CARELENS_VISION_URL": vision, "CARELENS_OLLAMA_URL": ollama, "CARELENS_POLL_INTERVAL_S": "2", **extra}
    return AgentConfig.from_env(env)


# ------------------------------------------------------------------ config and logging


def test_config_refuses_unsafe_endpoints_and_hides_the_token():
    with pytest.raises(ConfigError, match="https"):
        config("http://backend.example.com")
    with pytest.raises(ConfigError, match="loopback"):
        config("https://backend.example.com", vision="http://192.168.1.20:8080")
    with pytest.raises(ConfigError, match="loopback"):
        config("https://backend.example.com", ollama="http://10.0.0.5:11434")
    with pytest.raises(ConfigError, match="agent token"):
        AgentConfig.from_env({"CARELENS_BACKEND_URL": "https://b.example.com", "CARELENS_AGENT_TOKEN": "cld_device-token"})
    c = config("https://backend.example.com")
    assert AGENT_TOKEN not in repr(c)


def test_log_filter_masks_tokens_and_leases():
    import logging

    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "token %s lease %s", (AGENT_TOKEN, "lease_abcdefghijklmnop"), None)
    RedactingFilter().filter(rec)
    assert "test-agent-token" not in rec.getMessage() and "abcdefghijkl" not in rec.getMessage()


# ------------------------------------------------------------------ cloud protocol


def test_cloud_errors_are_classified(backend: FakeBackend):
    with pytest.raises(CloudError) as e:
        CloudClient(backend.url, "cla_wrong-token-0000000000", 5).claim(["vision"], 60, False)
    assert e.value.status == 401
    with pytest.raises(TransientError):
        CloudClient("http://127.0.0.1:9", AGENT_TOKEN, 1).claim(["vision"], 60, False)


def test_invalid_claim_responses_are_rejected(backend: FakeBackend):
    backend.jobs.append({"job_id": "j1", "kind": "vision", "attempt": 1, "payload": {}})  # no lease_token
    with pytest.raises(InvalidResponse):
        CloudClient(backend.url, AGENT_TOKEN, 5).claim(["vision"], 60, False)
    client = CloudClient(backend.url, AGENT_TOKEN, 5)
    client.request = lambda *a, **k: (200, {"job": {"job_id": "j2", "kind": "daily_report", "lease_token": "lease_x", "attempt": 1, "payload": {}}})  # type: ignore[method-assign]
    with pytest.raises(InvalidResponse, match="unexpected job kind"):
        client.claim(["vision"], 60, False)
    client.request = lambda *a, **k: (200, {"no_job_key": True})  # type: ignore[method-assign]
    with pytest.raises(InvalidResponse):
        client.claim(["vision"], 60, False)


def test_completion_retries_transient_failures_with_the_same_idempotency_key(backend: FakeBackend):
    backend.fail_next = [503, 502]
    out = CloudClient(backend.url, AGENT_TOKEN, 5).complete("j1", "lease_j1-0123456789", {"idempotency_key": "j1:attempt-1", "x": 1})
    assert out["duplicate"] is False and len(backend.completions) == 1
    again = CloudClient(backend.url, AGENT_TOKEN, 5).complete("j1", "lease_j1-0123456789", {"idempotency_key": "j1:attempt-1", "x": 1})
    assert again["duplicate"] is True and len(backend.completions) == 1


def test_hint_stream_yields_job_hints(backend: FakeBackend):
    backend.hint_frames = ['data: {"type":"stream.opened"}\n\n', ": keepalive\n\n", 'data: {"type":"job_available","kind":"vision","priority":100}\n\n', "data: {broken\n\n"]
    hints = list(CloudClient(backend.url, AGENT_TOKEN, 5).hints(threading.Event()))
    assert hints == [{"type": "stream.opened"}, {"type": "job_available", "kind": "vision", "priority": 100}]


# ------------------------------------------------------------------ summarizer


def test_report_generation_validates_and_reports_real_inference_counters(ollama: FakeOllama):
    ollama.outputs = [json.dumps(good_report(), ensure_ascii=False)]
    client = OllamaClient(ollama.url, "qwen3:4b-instruct-2507-q4_K_M", 10, "0", 4096)
    result = generate_report(client, {"input": report_input(), "input_snapshot_sha256": "a" * 64}, None)
    assert result["inference"] == {"eval_count": 42, "prompt_eval_count": 300, "total_duration_ms": 1500.0, "attempts": 1}
    assert result["model"]["digest"].startswith("0edcdef34593")
    req = ollama.requests[0]
    assert req["format"]["required"][0] == "schema_version" and req["keep_alive"] == "0" and req["options"]["temperature"] == 0
    assert "period_start" not in req["messages"][1]["content"]


def test_invented_numbers_trigger_one_corrective_retry_then_fail(ollama: FakeOllama):
    bad = dict(good_report(), summary_vi="Có 7 lần ngã.")
    ollama.outputs = [json.dumps(bad), json.dumps(good_report())]
    client = OllamaClient(ollama.url, "qwen3:4b-instruct-2507-q4_K_M", 10, "0", 4096)
    ok = generate_report(client, {"input": report_input(), "input_snapshot_sha256": "a" * 64}, None)
    assert ok["inference"]["attempts"] == 2 and "numbers not present" in ollama.requests[1]["messages"][-1]["content"]
    ollama.outputs = [json.dumps(bad), "not json"]
    with pytest.raises(ReportInvalid):
        generate_report(client, {"input": report_input(), "input_snapshot_sha256": "a" * 64}, None)


def test_validate_report_rules():
    inp = report_input()
    assert validate_report(good_report(), inp) == []
    assert "unknown source_event_id evt_x" in validate_report(dict(good_report(), source_event_ids=["fdc_1", "evt_x"]), inp)
    assert any("unexpected fields" in p for p in validate_report(dict(good_report(), diagnosis="x"), inp))
    assert any("not an unverified" in p for p in validate_report(dict(good_report(), unverified_items=[{"event_id": "evt_2", "note_vi": "x"}], source_event_ids=["fdc_1", "evt_2"]), inp))


def test_ollama_unavailable_or_model_missing(ollama: FakeOllama):
    with pytest.raises(OllamaUnavailable):
        OllamaClient("http://127.0.0.1:9", "m", 2, "0", 4096).model_digest()
    ollama.installed = False
    with pytest.raises(OllamaUnavailable, match="not installed"):
        OllamaClient(ollama.url, "qwen3:4b-instruct-2507-q4_K_M", 2, "0", 4096).model_digest()


def test_generation_can_be_cancelled_mid_stream(ollama: FakeOllama):
    ollama.outputs = [json.dumps(good_report()) * 3]
    ollama.delay_per_chunk = 0.2
    client = OllamaClient(ollama.url, "qwen3:4b-instruct-2507-q4_K_M", 10, "0", 4096)
    cancel = threading.Event()
    threading.Timer(0.3, lambda: (cancel.set(), client.abort())).start()
    t0 = time.monotonic()
    with pytest.raises(GenerationCancelled):
        generate_report(client, {"input": report_input(), "input_snapshot_sha256": "a" * 64}, cancel)
    assert time.monotonic() - t0 < 2


# ------------------------------------------------------------------ job processing


def test_vision_job_end_to_end_against_fakes(backend: FakeBackend, vision: FakeVision):
    backend.add_vision_job("job-v1", 40)
    agent = Agent(config(backend.url, vision.url))
    stats = agent.run_once(("vision",))
    assert stats["vision_completed"] == 1
    job_id, result = backend.completions[0]
    assert job_id == "job-v1" and result["idempotency_key"] == "job-v1:attempt-1"
    assert result["schema_version"] == "vision-result.v1" and len(result["fall"]["requests"]) == 3
    assert vision.calls[-1]["first"] == "neutral"


def test_vision_unavailable_is_a_retryable_failure_and_bad_media_is_not(backend: FakeBackend, vision: FakeVision):
    backend.add_vision_job("job-down")
    vision.mode = "http500"
    Agent(config(backend.url, vision.url)).run_once(("vision",))
    assert backend.failures[-1][1]["error_code"] == "vision_unavailable" and backend.failures[-1][1]["retryable"] is True
    vision.mode = "ok"
    frames = backend.add_vision_job("job-bad")
    backend.media[("job-bad", 0)] = backend.media[("job-bad", 0)][:-10]  # truncated chunk
    Agent(config(backend.url, vision.url)).run_once(("vision",))
    assert backend.failures[-1][1]["error_code"] == "invalid_media" and backend.failures[-1][1]["retryable"] is False
    assert frames  # fixture frames existed; nothing about them is reported back


def test_media_gone_abandons_the_job_without_inference(backend: FakeBackend, vision: FakeVision):
    backend.add_vision_job("job-gone")
    backend.media.clear()
    Agent(config(backend.url, vision.url)).run_once(("vision",))
    assert vision.calls == [] and backend.completions == [] and backend.failures == []


def test_report_job_completes_with_real_generation(backend: FakeBackend, ollama: FakeOllama):
    backend.add_report_job("job-r1", report_input())
    ollama.outputs = [json.dumps(good_report())]
    stats = Agent(config(backend.url, ollama=ollama.url)).run_once(("daily_report",))
    assert stats["reports_completed"] == 1
    assert backend.completions[0][1]["schema_version"] == "daily-report-result.v1"
    assert backend.claims[-1]["defer_if_vision_pending"] is True


def test_run_once_does_vision_before_reports(backend: FakeBackend, vision: FakeVision, ollama: FakeOllama):
    backend.add_report_job("job-r", report_input())
    backend.add_vision_job("job-v")
    ollama.outputs = [json.dumps(good_report())]
    Agent(config(backend.url, vision.url, ollama.url)).run_once()
    assert [c[0] for c in backend.completions] == ["job-v", "job-r"]


def test_urgent_vision_preempts_a_running_report(backend: FakeBackend, vision: FakeVision, ollama: FakeOllama):
    backend.add_report_job("job-slow-report", report_input())
    ollama.outputs = [json.dumps(good_report()) * 4, json.dumps(good_report())]
    ollama.delay_per_chunk = 0.15  # a long generation
    agent = Agent(config(backend.url, vision.url, ollama.url))
    runner = threading.Thread(target=agent.run, daemon=True)
    runner.start()
    deadline = time.monotonic() + 10
    while not agent.report_busy.is_set() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert agent.report_busy.is_set()
    started = time.monotonic()
    backend.add_vision_job("job-urgent", 40)
    agent.vision_wake.set()
    while not any(c[0] == "job-urgent" for c in backend.completions) and time.monotonic() < deadline + 10:
        time.sleep(0.05)
    vision_latency = time.monotonic() - started
    while not any(c[0] == "job-slow-report" for c in backend.completions) and time.monotonic() < deadline + 20:
        time.sleep(0.1)
    agent.stop.set()
    runner.join(timeout=10)
    assert any(c[0] == "job-urgent" for c in backend.completions)
    assert backend.releases and backend.releases[0][1]["reason"] == "preempted_by_vision"
    assert vision_latency < 5  # did not wait for the ~10 s report generation
    assert any(c[0] == "job-slow-report" for c in backend.completions)  # retried and finished afterwards
