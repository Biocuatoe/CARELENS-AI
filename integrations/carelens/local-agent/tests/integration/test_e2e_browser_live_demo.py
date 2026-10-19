"""Browser end-to-end: the real frontend (production build) signs in through its login form against a local
backend and shows records produced by the real models, in Chromium via Playwright.

    local backend (wrangler dev, temp dir) ← device harness + Local AI Agent + real Vision package
    frontend: `vite build` with VITE_API_BASE_URL=<local backend>, `vite preview` on :4173
    Playwright: frontend/e2e/live-demo-backend.spec.ts (login form → Live Demo → backend records)

Opt-in:  python -m pytest -m e2e tests/integration -s   (port 4173 must be free)
Builds frontend/dist (an ignored build artifact); changes no tracked file.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest
from stack import AGENT_DIR, ROOT, SAMPLES, local_backend, provision, require_vision_server

sys.path.insert(0, str(AGENT_DIR / "tools"))
import sample_device  # noqa: E402

from carelens_agent.config import AgentConfig  # noqa: E402
from carelens_agent.runner import Agent  # noqa: E402
from stack import http_json  # noqa: E402

pytestmark = pytest.mark.e2e
FRONTEND = ROOT / "frontend"
RECIPIENT, DEVICE = "rcp-e2e-browser", "esp32-e2e-browser"
PREVIEW_PORT = 4173


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def test_frontend_login_and_live_demo_show_real_backend_records():
    require_vision_server()
    if not port_free(PREVIEW_PORT):
        pytest.fail(f"port {PREVIEW_PORT} is in use; stop the running preview first")
    with local_backend({"ALLOWED_ORIGINS": f"http://localhost:{PREVIEW_PORT},http://127.0.0.1:{PREVIEW_PORT}"}) as stack:
        port = stack["port"]
        p = provision(port, stack["admin"], RECIPIENT, DEVICE)
        agent = Agent(AgentConfig.from_env({"CARELENS_BACKEND_URL": f"http://127.0.0.1:{port}", "CARELENS_AGENT_TOKEN": p["agent_token"], "CARELENS_OLLAMA_KEEP_ALIVE": "0", "CARELENS_AGENT_RUN_DIR": str(stack["tmp"] / "agent-run")}))
        dev = sample_device.HarnessDevice(sample_device.DeviceClient(f"http://127.0.0.1:{port}", p["device_token"]), DEVICE, seed=3)
        dev.heartbeat()
        # A firmware trigger, raw IMU and a 40-frame burst analysed by the real Vision package.
        frames = sample_device.load_frames(SAMPLES / "fall" / "esp32_1018_0s", SAMPLES / "fall" / "esp32_1104_16f", "triggered")
        first = dev.clock.uptime_ms() - 40 * 125 - 500
        dev.send_imu(first - 3000, dev.clock.uptime_ms() - 10)
        dev.trigger("trg-browser", first + 1500, "cap-browser")
        dev.upload_capture("cap-browser", frames, "triggered", "trg-browser", first)
        assert agent.run_once(("vision",))["vision_completed"] == 1
        # A voice message the device confirms it played.
        status, vm = http_json(port, "POST", f"/api/app/v1/recipients/{RECIPIENT}/voice-messages?title=E2E", p["caregiver"], raw=sample_device.synthetic_tone_wav(1.0), ctype="audio/wav")
        assert status == 201
        status, _ = http_json(port, "POST", f"/api/app/v1/recipients/{RECIPIENT}/devices/{DEVICE}/commands", p["caregiver"],
                              {"command_type": "play_voice_message", "voice_message_id": vm["voice_message"]["voice_message_id"], "idempotency_key": "browser-voice-0001", "expires_in_seconds": 300})
        assert status == 201
        assert [a[0] for a in dev.play_next_command()["acks"]] == ["accepted", "started", "completed"]

        npx = "npx.cmd" if os.name == "nt" else "npx"
        env = {**os.environ, "VITE_API_BASE_URL": f"http://127.0.0.1:{port}"}
        subprocess.run([npx, "vite", "build"], cwd=FRONTEND, env=env, check=True, capture_output=True, timeout=300)
        preview = subprocess.Popen([npx, "vite", "preview", "--port", str(PREVIEW_PORT), "--strictPort"], cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.time() + 60
            while time.time() < deadline:
                try:
                    if urllib.request.urlopen(f"http://localhost:{PREVIEW_PORT}/", timeout=3).status == 200:
                        break
                except OSError:
                    time.sleep(1)
            run = subprocess.run(
                [npx, "playwright", "test", "e2e/live-demo-backend.spec.ts", "--reporter=line"],
                cwd=FRONTEND,
                env={
                    **os.environ,
                    "E2E_LIVE_BACKEND_URL": f"http://127.0.0.1:{port}",
                    "E2E_LIVE_EMAIL": p["viewer_login"]["email"],
                    "E2E_LIVE_PASSWORD": p["viewer_login"]["password"],
                    "E2E_LIVE_EXPECT_TEXT": "đều chưa hiệu chỉnh nên hệ thống chưa kết luận|thiết bị xác nhận đã phát xong",
                },
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=300,
            )
            print(run.stdout[-3000:].encode("ascii", "replace").decode("ascii"))  # the Windows console may be cp1252
            assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
            assert "1 passed" in run.stdout
        finally:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(preview.pid)] if os.name == "nt" else ["kill", str(preview.pid)], capture_output=True)
