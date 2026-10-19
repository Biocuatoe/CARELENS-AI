"""Helpers for the opt-in end-to-end tests: a throw-away `wrangler dev` backend (local D1/R2/Durable Object
in a temp dir), HTTP helpers, provisioning through the admin API, and the frontend contract reader.
Nothing here can reach a deployed backend: every URL is 127.0.0.1."""
from __future__ import annotations

import contextlib
import hashlib
import http.client
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[5]
WORKER = ROOT / "backend" / "care-monitoring" / "worker"
AGENT_DIR = ROOT / "integrations" / "carelens" / "local-agent"
PACKAGE = Path(os.environ.get("CARELENS_VISION_PACKAGE_DIR", r"D:\AI\Models\CareLens-VLM\carelens_models_v1_20261018"))
SAMPLES = PACKAGE / "samples"
FRONTEND_ADAPTER = ROOT / "frontend" / "src" / "data" / "demo" / "demoAdapter.ts"
NPX = "npx.cmd" if os.name == "nt" else "npx"
QUIET_ENV = {**os.environ, "CI": "1", "WRANGLER_SEND_METRICS": "false", "NO_COLOR": "1"}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http_json(port: int, method: str, path: str, token: str | None = None, body: Any = None, timeout: float = 30, raw: bytes | None = None, ctype: str | None = None) -> tuple[int, Any]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    data = raw
    if raw is not None and ctype:
        headers["Content-Type"] = ctype
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    try:
        conn.request(method, path, body=data, headers=headers)
        r = conn.getresponse()
        payload = r.read()
        is_json = r.getheader("content-type", "").startswith(("application/json", "application/problem+json"))
        return r.status, (json.loads(payload) if payload and is_json else payload)
    finally:
        conn.close()


def first_sse_state(port: int, path: str) -> dict[str, Any]:
    """Reads the first `data:` frame of an SSE response (the frontend's EventSource sees the same bytes)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    conn.request("GET", path, headers={"Accept": "text/event-stream", "Origin": "http://localhost:5173"})
    resp = conn.getresponse()
    assert resp.status == 200 and resp.getheader("content-type", "").startswith("text/event-stream"), resp.status
    assert resp.getheader("access-control-allow-origin") == "http://localhost:5173"
    data: list[str] = []
    while True:
        line = resp.readline().decode().rstrip("\r\n")
        if line.startswith("data:"):
            data.append(line[5:].strip())
        elif line == "" and data:
            break
    conn.close()
    msg = json.loads("\n".join(data))
    assert msg["type"] == "state_update"
    return msg["state"]


def gpu_memory_mib() -> int | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10)
        return int(out.stdout.strip().splitlines()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def interface_fields(name: str) -> tuple[set[str], set[str]]:
    """(required, optional) field names of a TypeScript interface in the frontend adapter (read-only)."""
    src = FRONTEND_ADAPTER.read_text(encoding="utf-8")
    m = re.search(rf"interface {name} \{{(.*?)\n\}}", src, re.S)
    assert m, f"interface {name} not found in {FRONTEND_ADAPTER}"
    body = re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S)
    required, optional = set(), set()
    depth = 0
    for line in body.splitlines():
        fm = re.match(r"^\s*(\w+)(\??):", line)
        if fm and depth == 0:
            (optional if fm.group(2) else required).add(fm.group(1))
        depth += line.count("{") - line.count("}")
    return required, optional


def require_vision_server() -> None:
    try:
        conn = http.client.HTTPConnection("127.0.0.1", 8080, timeout=5)
        conn.request("GET", "/health")
        health = json.loads(conn.getresponse().read())
        conn.close()
    except OSError:
        pytest.fail("Vision server is not running on 127.0.0.1:8080 (start scripts/start_vision_server.ps1)")
    assert health["fall_heads"] == 3 and health["drink"] is True


@contextlib.contextmanager
def local_backend(variables: dict[str, str]) -> Iterator[dict[str, Any]]:
    """Starts `wrangler dev` on a free loopback port with a fresh local database and buckets."""
    tmp = Path(tempfile.mkdtemp(prefix="carelens-e2e-"))
    admin_token = "e2e-admin-" + secrets.token_urlsafe(24)
    port = free_port()
    subprocess.run([NPX, "wrangler", "d1", "migrations", "apply", "care_monitoring", "--local", "--persist-to", str(tmp)], cwd=WORKER, env=QUIET_ENV, check=True, capture_output=True, timeout=180)
    merged = {
        "ADMIN_TOKEN_SHA256": hashlib.sha256(admin_token.encode()).hexdigest(),
        "ACCEPT_SIMULATED_SOURCES": "true",
        "ENVIRONMENT": "e2e-test",
        "ALLOWED_ORIGINS": "http://localhost:5173",
        "SSE_MAX_LIFETIME_SECONDS": "60",
        # wrangler.jsonc is Google-only for production; these tests sign in with an owner-issued password.
        "PASSWORD_SIGN_IN": "enabled",
        **variables,
    }
    cmd = [NPX, "wrangler", "dev", "--ip", "127.0.0.1", "--port", str(port), "--persist-to", str(tmp), "--test-scheduled", "--show-interactive-dev-session=false"]
    for k, v in merged.items():
        cmd += ["--var", f"{k}:{v}"]
    log = open(tmp / "wrangler.log", "w", encoding="utf-8")  # noqa: SIM115
    proc = subprocess.Popen(cmd, cwd=WORKER, env=QUIET_ENV, stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                if http_json(port, "GET", "/health", timeout=3)[0] == 200:
                    break
            except OSError:
                time.sleep(1)
        else:
            pytest.fail(f"wrangler dev did not start; see {tmp / 'wrangler.log'}")
        yield {"port": port, "admin": admin_token, "tmp": tmp, "measurements": {}}
    finally:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)] if os.name == "nt" else ["kill", str(proc.pid)], capture_output=True)
        log.close()
        shutil.rmtree(tmp, ignore_errors=True)


def provision(port: int, admin: str, recipient: str, device: str) -> dict[str, Any]:
    """Recipient, device, agent, a caregiver (API token) and a viewer with a web sign-in credential."""
    assert http_json(port, "POST", "/api/admin/v1/recipients", admin, {"recipient_id": recipient, "display_label": "Hồ sơ kiểm thử E2E", "timezone": "Asia/Ho_Chi_Minh"})[0] == 201
    status, dev = http_json(port, "POST", "/api/admin/v1/devices", admin, {"device_id": device, "recipient_id": recipient, "label": "Thiết bị giả lập kiểm thử"})
    assert status == 201
    status, agent = http_json(port, "POST", "/api/admin/v1/agents", admin, {"label": "e2e agent"})
    assert status == 201
    status, cg = http_json(port, "POST", "/api/admin/v1/caregivers", admin, {"display_name": "Người chăm sóc kiểm thử", "token_expires_in_days": 1})
    assert status == 201
    assert http_json(port, "POST", "/api/admin/v1/grants", admin, {"user_id": cg["user_id"], "recipient_id": recipient, "role": "caregiver"})[0] == 201
    status, viewer = http_json(port, "POST", "/api/admin/v1/caregivers", admin, {"display_name": "Giám khảo kiểm thử", "token_expires_in_days": 1})
    assert status == 201
    assert http_json(port, "POST", "/api/admin/v1/grants", admin, {"user_id": viewer["user_id"], "recipient_id": recipient, "role": "viewer"})[0] == 201
    status, login = http_json(port, "POST", f"/api/admin/v1/caregivers/{viewer['user_id']}/login", admin, {"login_email": "giamkhao@example.invalid"})
    assert status == 201
    return {"device_token": dev["token"], "agent_token": agent["token"], "caregiver": cg["token"], "viewer_login": {"email": login["login_email"], "password": login["password"]}}


def sign_in_and_stream(port: int, login: dict[str, str], recipient: str) -> dict[str, Any]:
    """The frontend's production path: sign in, mint a single-use ticket, open /api/demo/stream with it."""
    status, session = http_json(port, "POST", "/api/app/v1/session", body=login)
    assert status == 201, session
    status, ticket = http_json(port, "POST", "/api/app/v1/stream-tickets", session["token"], {"recipient_id": recipient})
    assert status == 201, ticket
    state = first_sse_state(port, f"/api/demo/stream?ticket={ticket['ticket']}&last_seq=0")
    reuse, _ = http_json(port, "GET", f"/api/demo/stream?ticket={ticket['ticket']}")
    assert reuse == 401  # single use
    return {"state": state, "session": session}


def check_frontend_shapes(state: dict[str, Any]) -> None:
    for iface, objects in (("DemoStateFromBackend", [state]), ("EventFromBackend", state["events"]), ("AlertFromBackend", state["alerts"]), ("HubStateFromBackend", list(state["hubs"].values()))):
        required, _ = interface_fields(iface)
        for obj in objects:
            assert required <= set(obj), (iface, sorted(required - set(obj)))
