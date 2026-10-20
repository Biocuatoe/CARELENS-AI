"""Failure and recovery tests of the PHYSICAL device against the LOCAL backend (nothing here may point at production).

Owns the CH343 serial port for the whole run (device log + console commands), creates commands through the same admin API
the dashboard uses (local static development token), turns on one fault at a time in the local TLS proxy
(local_tls_proxy.py --faults), and records what the server and the device actually reported. Results:
<out>/e2e-failures.json and the device log <out>/device.log. A scenario passes only on the server's own final state.

Usage: python tools/e2e_failures.py --out D:/AI/Cache/Tmp/e2e-failures [--only corrupt_audio,reboot_during_playback]
"""
from __future__ import annotations

import argparse
import json
import secrets as pysecrets
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import serial

REPO = Path(__file__).resolve().parents[3]
API = "http://127.0.0.1:8787"
ADMIN_TOKEN = (REPO / "backend" / "care-monitoring" / "worker" / ".wrangler" / "dev-admin-token.txt").read_text(encoding="utf-8").strip()
SECRETS = Path(r"D:\AI\Cache\carelens-device")
FAULTS = SECRETS / "proxy-faults.json"
SHORT_WAV = SECRETS / "test-message-vi-16k.wav"
LONG_WAV = SECRETS / "test-long-vi-16k.wav"
FINAL = {"completed", "failed", "rejected", "cancelled", "expired", "superseded"}


def api(method: str, path: str, body=None, raw: bytes | None = None, ctype: str | None = None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    if data is not None:
        headers["Content-Type"] = ctype or "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


class Device:
    """Serial owner: a reader thread keeps the log; send() writes a console command."""

    def __init__(self, port: str, log_path: Path, redact: list[str]):
        self.ser = serial.Serial()
        self.ser.port, self.ser.baudrate, self.ser.timeout = port, 115200, 0.1
        self.ser.dtr = False
        self.ser.rts = False
        self.ser.open()
        self.lines: list[tuple[float, str]] = []
        self.redact = redact
        self.log = log_path.open("a", encoding="utf-8")
        self.stop = False
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        buf = b""
        while not self.stop:
            buf += self.ser.read(4096)
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                text = raw.decode("utf-8", "replace").rstrip("\r")
                for s in self.redact:
                    text = text.replace(s, "[REDACTED]")
                self.lines.append((time.time(), text))
                self.log.write(f"{time.strftime('%H:%M:%S')} {text}\n")
                self.log.flush()

    def send(self, cmd: str) -> None:
        self.log.write(f"{time.strftime('%H:%M:%S')} <<< {cmd.split(' ')[0]}\n")
        self.ser.write((cmd + "\n").encode())

    def wait_for(self, needle: str, since: float, timeout: float) -> str | None:
        end = time.time() + timeout
        while time.time() < end:
            for t, line in list(self.lines):
                if t >= since and needle in line:
                    return line
            time.sleep(0.2)
        return None

    def grep(self, needle: str, since: float) -> list[str]:
        return [line for t, line in self.lines if t >= since and needle in line]


def set_fault(faults: dict) -> None:
    FAULTS.write_text(json.dumps(faults), encoding="utf-8")


def upload(device_id: str, wav: Path, title: str) -> str:
    s, out = api("POST", f"/api/admin/v1/devices/{device_id}/voice-messages?title={urllib.request.quote(title)}", raw=wav.read_bytes(), ctype="audio/wav")
    if s != 201:
        raise SystemExit(f"upload failed: {s} {out.get('code')}")
    return out["voice_message"]["voice_message_id"]


def command(device_id: str, voice_id: str, expires: int = 300) -> str:
    s, out = api("POST", f"/api/admin/v1/devices/{device_id}/voice-commands",
                 {"voice_message_id": voice_id, "idempotency_key": "e2e-" + pysecrets.token_hex(8), "expires_in_seconds": expires, "confirm": True})
    if s not in (200, 201):
        raise SystemExit(f"command failed: {s} {out.get('code')}")
    return out["command"]["command_id"]


def final_state(cmd: str, timeout: float) -> dict:
    end = time.time() + timeout
    last: dict = {}
    while time.time() < end:
        s, out = api("GET", f"/api/admin/v1/commands/{cmd}")
        if s == 200:
            last = out
            if out["command"]["status"] in FINAL:
                return out
        time.sleep(1.5)
    return last


def summarize(view: dict) -> dict:
    c = view.get("command", {})
    return {
        "command_id": c.get("command_id"),
        "status": c.get("status"),
        "status_reason": c.get("status_reason"),
        "status_detail": c.get("status_detail"),
        "played_confirmed_by_device": c.get("played_confirmed_by_device"),
        "received_at": c.get("received_at"),
        "accepted_at": c.get("accepted_at"),
        "started_at": c.get("started_at"),
        "finished_at": c.get("finished_at"),
        "timeline": [f"{e['status']}:{e['actor_type']}{(':' + e['reason']) if e.get('reason') else ''}@{e['at'][11:23]}" for e in view.get("timeline", [])],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--port", default="COM6")
    ap.add_argument("--device-id", default="esp32s3-chest-01")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((SECRETS / "secrets.local.json").read_text(encoding="utf-8"))
    dev = Device(a.port, a.out / "device.log", [v for k, v in cfg.items() if k in ("wifi_pass", "token", "wifi_ssid") and isinstance(v, str)])
    results: dict = {}
    only = {x for x in a.only.split(",") if x}
    set_fault({})
    short_id = upload(a.device_id, SHORT_WAV, "E2E lỗi: bản ghi ngắn")

    def scenario(name: str):
        def wrap(fn):
            if only and name not in only:
                return
            t0 = time.time()
            print(f"--- {name}", flush=True)
            try:
                r = fn(t0)
            except Exception as e:  # noqa: BLE001 - a scenario error is a result, not a crash of the run
                r = {"pass": False, "error": f"{e.__class__.__name__}: {e}"}
            r["seconds"] = round(time.time() - t0, 1)
            results[name] = r
            print(json.dumps(r, ensure_ascii=False), flush=True)
            (a.out / "e2e-failures.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
            set_fault({})
            time.sleep(3)
        return wrap

    @scenario("corrupt_audio")
    def _(t0):
        set_fault({"corrupt_audio": True})
        cmd = command(a.device_id, short_id)
        v = summarize(final_state(cmd, 60))
        return {**v, "pass": v["status"] == "rejected" and v["status_reason"] == "audio_integrity_failed" and not v["started_at"],
                "device": dev.grep(cmd, t0)[-4:]}

    @scenario("audio_gone_410")
    def _(t0):
        set_fault({"audio_status": 410})
        cmd = command(a.device_id, short_id)
        v = summarize(final_state(cmd, 60))
        return {**v, "pass": v["status"] == "failed" and v["status_reason"] == "audio_download_failed" and not v["started_at"],
                "device": dev.grep(cmd, t0)[-3:]}

    @scenario("lost_completed_ack")
    def _(t0):
        set_fault({"drop_status_response": "completed"})
        cmd = command(a.device_id, short_id)
        v = summarize(final_state(cmd, 60))
        completed_events = [e for e in v["timeline"] if e.startswith("completed:")]
        dup = dev.wait_for(f"{cmd} -> completed (duplicate)", t0, 15)  # the retry follows the lost reply by ~1-2 s
        return {**v, "completed_events": len(completed_events), "device_duplicate_reply": bool(dup),
                "pass": v["status"] == "completed" and len(completed_events) == 1 and bool(dup), "device": dev.grep(cmd, t0)[-4:]}

    @scenario("lost_received_ack")
    def _(t0):
        set_fault({"drop_status_response": "received"})
        cmd = command(a.device_id, short_id)
        v = summarize(final_state(cmd, 60))
        received_events = [e for e in v["timeline"] if e.startswith("received:")]
        return {**v, "received_events": len(received_events), "pass": v["status"] == "completed" and len(received_events) == 1,
                "device": dev.grep(cmd, t0)[-6:]}

    @scenario("reboot_during_playback")
    def _(t0):
        long_id = upload(a.device_id, LONG_WAV, "E2E lỗi: bản ghi dài")
        cmd = command(a.device_id, long_id)
        started = dev.wait_for(f"{cmd} -> started", t0, 60)
        download = [ln for ln in dev.grep(cmd, t0) if "downloading" in ln or "audio verified" in ln]
        if not started:
            return {"pass": False, "error": "playback never started", "device": dev.grep(cmd, t0)}
        time.sleep(3)
        dev.send("reboot")
        v = summarize(final_state(cmd, 120))
        time.sleep(20)  # give a wrong replay a chance to show up
        replays = [ln for ln in dev.grep(f"{cmd} -> started", t0)]
        return {**v, "download_log": download, "started_reports": len(replays),
                "pass": v["status"] == "failed" and v["status_reason"] == "device_rebooted" and len(replays) == 1 and not v["played_confirmed_by_device"],
                "device": dev.grep(cmd, t0)[-6:]}

    @scenario("expired_while_offline")
    def _(t0):
        dev.send("wifidrop 70")
        time.sleep(3)
        cmd = command(a.device_id, short_id, expires=30)
        v = summarize(final_state(cmd, 150))
        back = dev.wait_for("wi-fi back", t0, 120)
        time.sleep(15)
        played = dev.grep(cmd, t0)
        return {**v, "wifi_back": back, "device_saw_command": played,
                "pass": v["status"] == "expired" and not v["started_at"] and not played and bool(back)}

    @scenario("wifi_drop_recovery")
    def _(t0):
        dev.send("wifidrop 20")
        lost = dev.wait_for("wi-fi lost", t0, 30)
        back = dev.wait_for("wi-fi back", t0, 120)
        hb = dev.wait_for("heartbeat ok", time.time(), 90)
        return {"wifi_lost": lost, "wifi_back": back, "heartbeat_after": hb, "pass": bool(lost and back and hb)}

    @scenario("slow_backend_timeout")
    def _(t0):
        set_fault({"delay_next_ms": 20000})
        err = dev.wait_for("commands/next transport error", t0, 40)
        cmd = command(a.device_id, short_id)
        v = summarize(final_state(cmd, 90))
        return {**v, "device_timeout": err, "pass": bool(err) and v["status"] == "completed"}

    @scenario("corrupt_chunk")
    def _(t0):
        set_fault({"corrupt_chunk": True})
        dev.send("burst")
        refused = dev.wait_for("refused", t0, 40)
        cap_line = dev.wait_for("burst cap-", t0, 40)
        return {"device_refusal": refused, "burst": cap_line, "pass": bool(refused and "frame_hash_mismatch" in refused)}

    dev.stop = True
    time.sleep(0.3)
    dev.ser.close()
    passed = sum(1 for r in results.values() if r.get("pass"))
    print(f"=== {passed}/{len(results)} scenarios passed; details in {a.out / 'e2e-failures.json'}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
