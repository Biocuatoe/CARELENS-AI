"""The agent's real result objects validate against the published JSON Schemas in contracts/carelens/.

Uses `jsonschema` when the test interpreter has it (the agent itself stays standard-library only).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import FakeOllama, FakeVision, good_report, payload, report_input

from carelens_agent.summarizer import OllamaClient, generate_report
from carelens_agent.vision import VisionClient, analyze

jsonschema = pytest.importorskip("jsonschema")
CONTRACTS = Path(__file__).resolve().parents[4] / "contracts" / "carelens"


def schema(name: str) -> dict:
    return json.loads((CONTRACTS / f"{name}.schema.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("count", [24, 40])
def test_vision_results_validate_against_vision_result_v1(vision: FakeVision, count: int):
    p, frames = payload(count)
    result, _ = analyze(p, [memoryview(f) for f in frames], VisionClient(vision.url, 5), "carelens_models_v1_20261018")
    result["idempotency_key"] = "job_x:attempt-1"
    jsonschema.validate(result, schema("vision-result.v1"))


def test_vision_result_schema_rejects_image_bytes(vision: FakeVision):
    p, frames = payload(24)
    result, _ = analyze(p, [memoryview(f) for f in frames], VisionClient(vision.url, 5), "pkg")
    result["idempotency_key"] = "job_x:attempt-1"
    result["frames_b64"] = ["/9j/4AAQ"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(result, schema("vision-result.v1"))


def test_daily_report_result_validates_against_daily_report_result_v1(ollama: FakeOllama):
    ollama.outputs = [json.dumps(good_report(), ensure_ascii=False)]
    client = OllamaClient(ollama.url, "qwen3:4b-instruct-2507-q4_K_M", 10, "0", 4096)
    result = generate_report(client, {"input": report_input(), "input_snapshot_sha256": "a" * 64}, None)
    result["idempotency_key"] = "job_r:attempt-1"
    jsonschema.validate(result, schema("daily-report-result.v1"))
