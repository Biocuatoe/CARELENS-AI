"""End-to-end ALERT path with the real Vision package, against a throw-away local backend that runs a
TEST-ONLY fusion policy.

The policy below is a plumbing fixture, not a threshold: its vision rule accepts every fall-check score
(min_score -1000) and its IMU rule fires on the synthetic spike the harness injects. It exists only to drive
the code path "aligned raw IMU + vision candidate → provisional alert → emergency buzzer command → device
acknowledgement → caregiver action → Live Demo stream" with real inference in the loop. It proves nothing
about detection accuracy, and no such policy is configured anywhere else.

Opt-in:  python -m pytest -m e2e tests/integration -s
"""
from __future__ import annotations

import json
import sys

import pytest
from stack import AGENT_DIR, SAMPLES, check_frontend_shapes, http_json, local_backend, provision, require_vision_server, sign_in_and_stream

sys.path.insert(0, str(AGENT_DIR / "tools"))
import sample_device  # noqa: E402

from carelens_agent.config import AgentConfig  # noqa: E402
from carelens_agent.runner import Agent  # noqa: E402

pytestmark = pytest.mark.e2e
RECIPIENT, DEVICE = "rcp-e2e-alert", "esp32-e2e-alert"

PLUMBING_ONLY_POLICY = {
    "policy_version": "fusion-rules.e2e-plumbing-only",
    "correlation_window_seconds": 10,
    "imu_decision_grace_seconds": 120,
    "imu_wait_seconds": 60,
    "alignment_tolerance_ms": 3000,
    "imu_search_margin_ms": 10000,
    "imu_min_coverage_ratio": 0.8,
    "imu_max_gap_ms": 500,
    "vision_candidate_rule": {
        "rule_version": "e2e-plumbing-accept-all",
        "model_version": "carelens_models_v1_20261018",
        "capture_modes": ["triggered"],
        "aggregations": ["max_request_score_overlapping.v1"],
        "min_score": -1000,
        "calibration": "uncalibrated_trial",
        "approved_by": "e2e-test-suite",
        "approved_at": "2026-10-19",
        "evidence_ref": "plumbing test only; accepts every score; no clinical meaning",
    },
    "imu_candidate_rule": {
        "rule_version": "e2e-plumbing-synthetic-spike",
        "min_peak_accel_g": 2.0,
        "max_min_accel_g": None,
        "min_peak_gyro_dps": 150,
        "calibration": "uncalibrated_trial",
        "approved_by": "e2e-test-suite",
        "approved_at": "2026-10-19",
        "evidence_ref": "plumbing test only; matches the harness's synthetic spike; no clinical meaning",
    },
    "alert_dedup_window_seconds": 120,
    "device_buzzer_on_alert": True,
}


@pytest.fixture(scope="module")
def world():
    require_vision_server()
    with local_backend({"FUSION_POLICY_JSON": json.dumps(PLUMBING_ONLY_POLICY)}) as stack:
        port = stack["port"]
        p = provision(port, stack["admin"], RECIPIENT, DEVICE)
        config = AgentConfig.from_env({"CARELENS_BACKEND_URL": f"http://127.0.0.1:{port}", "CARELENS_AGENT_TOKEN": p["agent_token"], "CARELENS_OLLAMA_KEEP_ALIVE": "0", "CARELENS_AGENT_RUN_DIR": str(stack["tmp"] / "agent-run")})
        device = sample_device.HarnessDevice(sample_device.DeviceClient(f"http://127.0.0.1:{port}", p["device_token"]), DEVICE, seed=11)
        device.heartbeat()
        yield {**p, "device": device, "agent": Agent(config), "port": port, "stack": stack}


def test_aligned_evidence_raises_a_provisional_alert_that_reaches_device_caregiver_and_live_demo(world):
    port, dev = world["port"], world["device"]
    status, ready = http_json(port, "GET", "/ready")
    assert ready["capabilities"]["alerts"] == "provisional_suspected_fall_needs_aligned_vision_and_raw_imu"

    frames = sample_device.load_frames(SAMPLES / "fall" / "esp32_1018_0s", SAMPLES / "fall" / "esp32_1104_16f", "triggered")
    first = dev.clock.uptime_ms() - 40 * 125 - 500
    spike = first + 1500  # inside the burst window
    dev.send_imu(first - 3000, dev.clock.uptime_ms() - 10, spikes=(spike,))
    dev.trigger("trg-e2e-alert", spike, "cap-e2e-alert")
    dev.upload_capture("cap-e2e-alert", frames, "triggered", "trg-e2e-alert", first)
    assert world["agent"].run_once(("vision",))["vision_completed"] == 1

    status, alerts = http_json(port, "GET", f"/api/app/v1/recipients/{RECIPIENT}/alerts", world["caregiver"])
    assert status == 200 and len(alerts["items"]) == 1
    alert = alerts["items"][0]
    assert alert["status"] == "open" and "cần người chăm sóc xác minh" in alert["summary_vi"] and "ngưỡng thử" in alert["summary_vi"]
    status, decisions = http_json(port, "GET", f"/api/app/v1/recipients/{RECIPIENT}/fusion-decisions", world["caregiver"])
    d = decisions["items"][0]
    assert (d["status"], d["case_code"], d["verification_status"]) == ("suspected_fall", "aligned_candidates", "unverified")
    assert d["explanation"]["imu"]["match_uptime_ms"] == spike and d["explanation"]["vision"]["score_semantics"] == "uncalibrated_logit_not_probability"

    # Downstream: the device receives the emergency buzzer, and it counts as sounded only on its own reports.
    run = dev.play_next_command()
    assert run["command"]["command_type"] == "emergency_buzzer" and run["command"]["preempts_lower_priority"] is True
    assert run["command"]["action"]["duration_ms"] == 30000
    assert run["acks"] == [("accepted", 200), ("started", 200), ("completed", 200)]

    # Caregiver acknowledges; the Live Demo stream (sign-in + ticket) shows the alert, its version and the buzzer outcome.
    status, acted = http_json(port, "POST", f"/api/app/v1/recipients/{RECIPIENT}/alerts/{alert['alert_id']}/actions", world["caregiver"],
                              {"action": "acknowledge", "expected_version": 1, "review_outcome": None, "note": None})
    assert status == 200 and acted["alert"]["status"] == "acknowledged"
    state = sign_in_and_stream(port, world["viewer_login"], RECIPIENT)["state"]
    check_frontend_shapes(state)
    assert state["alerts"][0]["status"] == "acknowledged" and state["alerts"][0]["version"] == 2
    fall_event = next(e for e in state["events"] if e["category"] == "fall_like")
    assert fall_event["alert_id"] == alert["alert_id"] and fall_event["type"] == "suspected_fall"
    buzzer = next(e for e in state["events"] if e["type"].startswith("device_command_"))
    assert buzzer["type"] == "device_command_completed" and "thiết bị xác nhận" in buzzer["summary"]
    status_line = next(e for e in state["events"] if e["type"] == "system_status")
    assert "quy tắc đã duyệt" in status_line["summary"]


def test_the_viewer_session_cannot_act_on_the_alert(world):
    session = sign_in_and_stream(world["port"], world["viewer_login"], RECIPIENT)["session"]
    status, alerts = http_json(world["port"], "GET", f"/api/app/v1/recipients/{RECIPIENT}/alerts", session["token"])
    assert status == 200
    status, body = http_json(world["port"], "POST", f"/api/app/v1/recipients/{RECIPIENT}/alerts/{alerts['items'][0]['alert_id']}/actions", session["token"],
                             {"action": "start", "expected_version": 2, "review_outcome": None, "note": None})
    assert status == 403 and body["code"] == "permission_denied"
