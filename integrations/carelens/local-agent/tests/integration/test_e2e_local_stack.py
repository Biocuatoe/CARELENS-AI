"""End-to-end test of the non-firmware pipeline on this PC with the real model package and real Ollama, under
the DEFAULT policy (no approved rules: records and review items only, no fall alerts).

    cloud backend (wrangler dev, local D1/R2/Durable Object in a temp dir)
      ← sample_device.py (TEST HARNESS: bundled sample frames, simulated clock, synthetic raw IMU)
      → Local AI Agent → Vision API 127.0.0.1:8080 (real R3D-18 / YOLO11n) and Ollama (real Qwen3)
      → results, fusion decision, Live Demo stream via sign-in + ticket, device command + audio, daily report

Opt-in:  python -m pytest -m e2e tests/integration -s
Needs:   the Vision server running (scripts/start_vision_server.ps1), Ollama with the summary model,
         node/npm with backend/care-monitoring/worker dependencies installed.
It checks plumbing and reference agreement with samples/expected.json. It is NOT an accuracy test and
says nothing about ESP32 hardware.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from stack import AGENT_DIR, NPX, QUIET_ENV, SAMPLES, WORKER, check_frontend_shapes, gpu_memory_mib, http_json, local_backend, provision, require_vision_server, sign_in_and_stream

sys.path.insert(0, str(AGENT_DIR / "tools"))
import sample_device  # noqa: E402

from carelens_agent.config import AgentConfig  # noqa: E402
from carelens_agent.runner import Agent  # noqa: E402

pytestmark = pytest.mark.e2e
RECIPIENT, DEVICE = "rcp-e2e-1", "esp32-e2e-01"


@pytest.fixture(scope="module")
def stack():
    require_vision_server()
    with local_backend({"LEGACY_STREAM_RECIPIENT_ID": RECIPIENT, "LEGACY_STREAM_DEVICE_ID": DEVICE, "LEGACY_STREAM_ALLOWED_IPS": "127.0.0.1/32,::1/128"}) as s:
        yield s


@pytest.fixture(scope="module")
def world(stack):
    port = stack["port"]
    p = provision(port, stack["admin"], RECIPIENT, DEVICE)
    config = AgentConfig.from_env({"CARELENS_BACKEND_URL": f"http://127.0.0.1:{port}", "CARELENS_AGENT_TOKEN": p["agent_token"], "CARELENS_OLLAMA_KEEP_ALIVE": "0", "CARELENS_AGENT_RUN_DIR": str(stack["tmp"] / "agent-run")})
    device = sample_device.HarnessDevice(sample_device.DeviceClient(f"http://127.0.0.1:{port}", p["device_token"]), DEVICE, seed=7)
    device.heartbeat()
    return {**p, "device": device, "agent": Agent(config), "port": port}


def expected() -> dict[str, Any]:
    return json.loads((SAMPLES / "expected.json").read_text(encoding="utf-8"))["samples"]


def events_for(world, capture_id: str) -> dict[str, dict[str, Any]]:
    status, body = http_json(world["port"], "GET", f"/api/app/v1/recipients/{RECIPIENT}/events?limit=200", world["caregiver"])
    assert status == 200
    return {e["event_type"]: e for e in body["items"] if e.get("capture_id") == capture_id}


def test_normal_capture_fall_sample_matches_package_reference(stack, world):
    frames = sample_device.load_frames(SAMPLES / "fall" / "phone_232215_fall_4s", None, "normal")
    gpu_before = gpu_memory_mib()
    world["device"].upload_capture("cap-e2e-fall", frames, "normal")
    t0 = time.perf_counter()
    stats = world["agent"].run_once(("vision",))
    stack["measurements"]["normal_24_frame_job_s"] = round(time.perf_counter() - t0, 3)
    stack["measurements"]["gpu_mib_before_after_vision"] = (gpu_before, gpu_memory_mib())
    assert stats["vision_completed"] == 1
    ev = events_for(world, "cap-e2e-fall")
    fall = ev["fall_check"]
    ref = expected()["fall"]["phone_232215_fall_4s"]["reference"]["cuda"]["score"]
    assert abs(fall["model_score"] - ref) < 1e-3, (fall["model_score"], ref)
    assert (fall["classification"], fall["calibration_status"], fall["score_kind"]) == ("uncalibrated_output", "not_calibrated", "uncalibrated_logit")
    assert fall["evidence"]["requests"][0]["package_status"] == "NOT_CALIBRATED"
    assert fall["boot_id"] == world["device"].clock.boot_id
    assert "drink_check" in ev


def test_normal_capture_drink_sample_matches_package_reference(world):
    frames = sample_device.load_frames(SAMPLES / "drink" / "med1_5s", None, "normal")
    world["device"].upload_capture("cap-e2e-drink", frames, "normal")
    assert world["agent"].run_once(("vision",))["vision_completed"] >= 2
    drink = events_for(world, "cap-e2e-drink")["drink_check"]
    ref = expected()["drink"]["med1_5s"]["reference"]["cuda"]
    assert drink["label"] == ref["label"] == "uong_thuoc"
    assert drink["classification"] == "medicine_observed"
    assert drink["evidence"]["requests"][0]["evidence"] == ref["evidence"]
    assert "detections" not in json.dumps(drink)


def test_triggered_40_frame_capture_with_raw_imu_is_split_and_fused_on_the_device_clock(stack, world):
    frames = sample_device.load_frames(SAMPLES / "fall" / "esp32_1018_0s", SAMPLES / "fall" / "esp32_1104_16f", "triggered")
    dev = world["device"]
    first = dev.clock.uptime_ms() - 40 * 125 - 500
    batches = dev.send_imu(first - 4000, dev.clock.uptime_ms() - 10)
    assert all(b["created"] for b in batches)
    assert dev.trigger("trg-e2e-1", first + 12 * 125, "cap-e2e-trig")["fusion"] == "waiting"
    dev.upload_capture("cap-e2e-trig", frames, "triggered", "trg-e2e-1", first)
    t0 = time.perf_counter()
    world["agent"].run_once(("vision",))
    stack["measurements"]["triggered_40_frame_job_s"] = round(time.perf_counter() - t0, 3)
    fall = events_for(world, "cap-e2e-trig")["fall_check"]
    reqs = fall["evidence"]["requests"]
    assert [(r["frame_start"], r["frame_end"]) for r in reqs] == [(0, 23), (8, 31), (16, 39)]
    ref = expected()["fall"]["esp32_1018_0s"]["reference"]["cuda"]["score"]  # frames 0–23 are exactly this sample
    assert abs(reqs[0]["score"] - ref) < 1e-3, (reqs[0]["score"], ref)
    assert fall["model_score"] == max(r["score"] for r in reqs)
    status, body = http_json(world["port"], "GET", f"/api/app/v1/recipients/{RECIPIENT}/fusion-decisions", world["caregiver"])
    decision = next(d for d in body["items"] if d["capture_pk"] == fall["capture_pk"])
    assert (decision["status"], decision["case_code"], decision["alert_decision"]) == ("needs_review", "rules_not_configured", "none")
    imu = decision["explanation"]["imu"]
    assert imu["state"] == "rule_not_configured" and imu["coverage"]["ratio"] >= 0.8
    assert imu["window"] == {"boot_id": dev.clock.boot_id, "from_uptime_ms": first, "until_uptime_ms": first + 39 * 125}
    # Raw samples of that window are retrievable for investigation.
    frm = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    to = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    status, raw = http_json(world["port"], "GET", f"/api/app/v1/recipients/{RECIPIENT}/imu-samples?device_id={DEVICE}&from={frm}&to={to}", world["caregiver"])
    assert status == 200 and sum(len(i["samples"]["ax"]) for i in raw["items"]) >= 900


def test_no_media_remains_after_processing(stack, world):
    status, body = http_json(world["port"], "GET", "/api/admin/v1/status", stack["admin"])
    assert status == 200
    assert sum(int(c.get("media_present") or 0) for c in body["captures"]) == 0, body["captures"]
    assert any(r["kind"] == "vision" and r["last_completed_at"] for r in body["last_successful_inference"])
    for capture_id in ("cap-e2e-fall", "cap-e2e-drink", "cap-e2e-trig"):
        status, cap = world["device"].client.call("GET", f"/api/device/v1/captures/{capture_id}")
        assert status == 200 and cap["capture"]["media_deleted"] is True and cap["capture"]["status"] == "processed"
    leftovers = [p for p in (stack["tmp"]).rglob("*") if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg")]
    assert leftovers == []


def test_live_demo_stream_via_sign_in_and_ticket_matches_the_frontend_contract(world):
    state = sign_in_and_stream(world["port"], world["viewer_login"], RECIPIENT)["state"]
    check_frontend_shapes(state)
    assert state["care_monitoring"]["data_exposed"] is True
    assert state["hubs"]["d_hub_liveshowcase"]["online"] is True
    categories = {(e["category"], e["type"]) for e in state["events"]}
    assert ("fall_like", "needs_review") in categories and ("care_activity", "medicine") in categories
    assert all(e["recipient_id"] == "r_liveshowcase" for e in state["events"])
    assert all(e["source_mode"] in ("simulated", "system") for e in state["events"])
    status_line = next(e for e in state["events"] if e["type"] == "system_status")
    assert "chưa hiệu chỉnh" in status_line["summary"]


def test_downstream_voice_message_reaches_the_device_and_only_completes_on_its_report(world):
    port, cg = world["port"], world["caregiver"]
    wav = sample_device.synthetic_tone_wav(1.5)
    status, vm = http_json(port, "POST", f"/api/app/v1/recipients/{RECIPIENT}/voice-messages?title=E2E", cg, raw=wav, ctype="audio/wav")
    assert status == 201, vm
    vm_id = vm["voice_message"]["voice_message_id"]
    status, created = http_json(port, "POST", f"/api/app/v1/recipients/{RECIPIENT}/devices/{DEVICE}/commands", cg,
                                {"command_type": "play_voice_message", "voice_message_id": vm_id, "idempotency_key": "e2e-voice-0001", "expires_in_seconds": 300})
    assert status == 201 and created["command"]["played_confirmed_by_device"] is False
    command_id = created["command"]["command_id"]
    run = world["device"].play_next_command()
    assert run["command"]["command_id"] == command_id
    assert run["audio_bytes"] == len(wav)
    assert run["acks"] == [("accepted", 200), ("started", 200), ("completed", 200)]
    status, timeline = http_json(port, "GET", f"/api/app/v1/recipients/{RECIPIENT}/commands/{command_id}", cg)
    assert timeline["command"]["played_confirmed_by_device"] is True
    assert [t["status"] for t in timeline["timeline"]] == ["queued", "delivered", "accepted", "started", "completed"]
    state = sign_in_and_stream(port, world["viewer_login"], RECIPIENT)["state"]
    voice = next(e for e in state["events"] if e["id"] == command_id)
    assert "thiết bị xác nhận đã phát xong" in voice["summary"]
    # The audio route closes once the command is finished.
    assert world["device"].client.call_raw("GET", f"/api/device/v1/commands/{command_id}/audio")[0] == 404


def test_daily_report_runs_through_real_ollama(stack, world):
    # Test-only: back-date the recipient so yesterday (local) is a reportable full day in this throw-away DB.
    tz = timezone(timedelta(hours=7))
    yesterday_start_utc = (datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)).astimezone(timezone.utc)
    stamp = yesterday_start_utc.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    subprocess.run([NPX, "wrangler", "d1", "execute", "care_monitoring", "--local", "--persist-to", str(stack["tmp"]), "--command", f"UPDATE care_recipients SET created_at = '{stamp}' WHERE recipient_id = '{RECIPIENT}'"],
                   cwd=WORKER, env=QUIET_ENV, check=True, capture_output=True, timeout=120)
    status, _ = http_json(stack["port"], "GET", "/__scheduled?cron=15+17+*+*+*")
    assert status == 200
    gpu_before = gpu_memory_mib()
    t0 = time.perf_counter()
    stats = world["agent"].run_once(("daily_report",))
    stack["measurements"]["daily_report_job_s"] = round(time.perf_counter() - t0, 3)
    stack["measurements"]["gpu_mib_before_after_report"] = (gpu_before, gpu_memory_mib())
    assert stats["reports_completed"] == 1, stats
    date = (datetime.now(tz) - timedelta(days=1)).strftime("%Y-%m-%d")
    status, body = http_json(world["port"], "GET", f"/api/app/v1/recipients/{RECIPIENT}/daily-reports/{date}", world["caregiver"])
    assert status == 200
    report = body["report"]
    assert report["status"] == "completed"
    assert report["model"]["name"] == "qwen3:4b-instruct-2507-q4_K_M" and report["model"]["inference"]["eval_count"] > 0
    assert report["ai_summary"]["summary_vi"].strip()
    stack["measurements"]["report_summary_vi"] = report["ai_summary"]["summary_vi"]
    out = Path(tempfile.gettempdir()) / "carelens-e2e-measurements.json"
    out.write_text(json.dumps(stack["measurements"], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nE2E measurements written to {out}")


def test_agent_heartbeat_reaches_the_status_view(stack, world):
    agent = world["agent"]
    agent.cloud.heartbeat({"agent_version": "e2e", "stats": dict(agent.stats), "health": dict(agent.health)})
    status, body = http_json(stack["port"], "GET", "/api/admin/v1/status", stack["admin"])
    assert status == 200
    reported = body["agents"][0]
    assert reported["connected"] is True and reported["reported"]["health"]["last_vision_completed_at"]
    assert body["devices"][0]["heartbeat_status"]["camera"] == "ok"
    assert os.environ.get("CARELENS_AGENT_TOKEN") is None or "cla_" not in json.dumps(body)
