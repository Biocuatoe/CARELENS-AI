"""TEST-ONLY device stand-in: speaks the device API (capture-session.v2, imu-batch.v1, imu-event.v2,
device-heartbeat.v2, command-status.v2) with the Vision package's bundled sample frames.

It exists to exercise the real cloud ↔ agent ↔ Vision path and the downstream command/audio path without
an ESP32. It is not firmware and proves nothing about the device: its clock is simulated, its IMU samples
are synthetic noise (plus optional synthetic spikes that are NOT a fall signature), and every upload is
labelled source_mode="simulated". It refuses any backend that is not on this machine (127.0.0.1 /
localhost), so it can never feed a production backend. The device token is read from the environment
variable named by --token-env.

  python tools/sample_device.py --api-url http://127.0.0.1:8787 --device-id esp32-e2e-01 \
      --sample-dir D:\\AI\\Models\\CareLens-VLM\\carelens_models_v1_20261018\\samples\\fall\\esp32_1104_0s \
      [--extra-sample-dir <dir with ≥16 frames>  (triggered: 24 + 16 frames, a composed test input)] \
      [--mode normal|triggered] [--imu] [--commands] [--capture-id ID] [--seed N]
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import math
import os
import random
import secrets
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

FRAME_INTERVAL_MS = 125


def _loopback(url: str) -> bool:
    return (urlparse(url).hostname or "") in ("127.0.0.1", "localhost", "::1")


def jpeg_dims(data: bytes) -> tuple[int, int]:
    i = 2
    while i < len(data):
        marker = data[i + 1]
        length = (data[i + 2] << 8) | data[i + 3]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return (data[i + 7] << 8) | data[i + 8], (data[i + 5] << 8) | data[i + 6]
        i += 2 + length
    raise ValueError("no SOF marker")


class DeviceClient:
    def __init__(self, api_url: str, token: str) -> None:
        if not _loopback(api_url):
            raise SystemExit("sample_device.py only talks to a backend on this machine (test harness)")
        p = urlparse(api_url)
        self.host, self.port, self.token = p.hostname or "127.0.0.1", p.port or 80, token

    def call(self, method: str, path: str, body: Any = None, raw: bytes | None = None, ctype: str = "application/json", headers: dict[str, str] | None = None) -> tuple[int, Any]:
        status, data, _ = self.call_raw(method, path, body, raw, ctype, headers)
        try:
            return status, (json.loads(data) if data else None)
        except ValueError:
            return status, data

    def call_raw(self, method: str, path: str, body: Any = None, raw: bytes | None = None, ctype: str = "application/json", headers: dict[str, str] | None = None) -> tuple[int, bytes, dict[str, str]]:
        conn = http.client.HTTPConnection(self.host, self.port, timeout=30)
        h = {"Authorization": f"Bearer {self.token}", **(headers or {})}
        data = None
        if raw is not None:
            data, h["Content-Type"] = raw, ctype
        elif body is not None:
            data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
        try:
            conn.request(method, path, body=data, headers=h)
            resp = conn.getresponse()
            return resp.status, resp.read(), {k.lower(): v for k, v in resp.getheaders()}
        finally:
            conn.close()


class DeviceClock:
    """Simulated ESP32 clock: a random boot_id and a monotonic uptime that started `uptime_at_start_ms` ago."""

    def __init__(self, uptime_at_start_ms: int = 3_600_000, boot_id: str | None = None, wall_synced: bool = True) -> None:
        self.boot_id = boot_id or f"boot-{secrets.token_hex(6)}"
        self._t0 = time.monotonic()
        self._u0 = uptime_at_start_ms
        self.wall_synced = wall_synced

    def uptime_ms(self) -> int:
        return self._u0 + int((time.monotonic() - self._t0) * 1000)

    def block(self) -> dict[str, Any]:
        wall = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") if self.wall_synced else None
        return {"boot_id": self.boot_id, "uptime_ms": self.uptime_ms(), "wall_clock_synced": self.wall_synced, "wall_time": wall}


class HarnessDevice:
    """The documented device protocol, driven by tests. Not firmware."""

    def __init__(self, client: DeviceClient, device_id: str, clock: DeviceClock | None = None, seed: int = 1) -> None:
        self.client, self.device_id = client, device_id
        self.clock = clock or DeviceClock()
        self.rng = random.Random(seed)
        self.imu_seq = 0

    def _ok(self, what: str, status: int, body: Any, allowed: tuple[int, ...]) -> Any:
        if status not in allowed:
            raise SystemExit(f"{what} failed: {status} {body}")
        return body

    def heartbeat(self) -> dict[str, Any]:
        body = {
            "schema_version": "device-heartbeat.v2",
            "device_id": self.device_id,
            "clock": self.clock.block(),
            "firmware_version": "test-harness-sample-device",
            # Like firmware >= carelens-fw-0.2.0 talking to the current Worker (ADR-025): it reports the codecs it plays.
            "status": {"camera": "ok", "imu": "ok", "speaker": "ok", "wifi_rssi_dbm": -60, "free_heap_bytes": 150_000, "last_error": None, "audio_codecs": ["pcm_s16le", "mp3"]},
        }
        return self._ok("heartbeat", *self.client.call("POST", "/api/device/v1/heartbeat", body), allowed=(200,))

    def upload_capture(self, capture_id: str, frames: list[bytes], mode: str, trigger_id: str | None = None, first_uptime_ms: int | None = None) -> dict[str, Any]:
        """Manifest → chunks → complete. Frames are spaced 125 ms on the device clock and end before 'now'."""
        w, h = jpeg_dims(frames[0])
        first = first_uptime_ms if first_uptime_ms is not None else self.clock.uptime_ms() - len(frames) * FRAME_INTERVAL_MS - 500
        manifest = {
            "schema_version": "capture-session.v2",
            "source_mode": "simulated",
            "device_id": self.device_id,
            "capture_id": capture_id,
            "mode": mode,
            "clock": self.clock.block(),
            "frame_count": len(frames),
            "nominal_fps": 8,
            "content_type": "image/jpeg",
            "frame_width": w,
            "frame_height": h,
            "frames": [{"seq": i, "uptime_ms": first + i * FRAME_INTERVAL_MS, "size_bytes": len(f), "sha256": hashlib.sha256(f).hexdigest()} for i, f in enumerate(frames)],
            "trigger_id": trigger_id if mode == "triggered" else None,
            "trigger_frame_index": 12 if mode == "triggered" else None,
            "firmware_version": "test-harness-sample-device",
        }
        body = self._ok("create capture", *self.client.call("POST", "/api/device/v1/captures", manifest), allowed=(200, 201))
        k, n = body["upload"]["frames_per_chunk"], body["upload"]["chunk_count"]
        for c in range(n):
            chunk = b"".join(struct.pack("<I", len(f)) + f for f in frames[c * k : (c + 1) * k])
            self._ok(f"chunk {c}", *self.client.call("PUT", f"/api/device/v1/captures/{capture_id}/chunks/{c}", raw=chunk, ctype="application/octet-stream"), allowed=(200,))
        done = self._ok("complete", *self.client.call("POST", f"/api/device/v1/captures/{capture_id}/complete"), allowed=(200, 202))
        done["first_uptime_ms"] = first
        done["last_uptime_ms"] = first + (len(frames) - 1) * FRAME_INTERVAL_MS
        return done

    def send_imu(self, from_uptime: int, until_uptime: int, spikes: tuple[int, ...] = (), rate_hz: int = 100) -> list[dict[str, Any]]:
        """Raw MPU6050 batches of 1 s covering [from, until] on the device clock. Synthetic noise around 1 g;
        a spike is a single made-up sample (≈2.7 g, ≈220 °/s) for plumbing tests, not a fall signature."""
        step = 1000 // rate_hz
        ts = list(range(from_uptime, until_uptime + 1, step))
        rows = []
        for t in ts:
            if any(abs(t - s) < step / 2 for s in spikes):
                rows.append((t, 2.4, 0.3, -1.2, 200.0, 90.0, 30.0))
            else:
                n = lambda a: round(self.rng.uniform(-a, a), 4)  # noqa: E731
                rows.append((t, n(0.02), n(0.02), round(0.98 + n(0.02), 4), n(1.5), n(1.5), n(1.5)))
        results = []
        for i in range(0, len(rows), rate_hz):
            part = rows[i : i + rate_hz]
            body = {
                "schema_version": "imu-batch.v1",
                "source_mode": "simulated",
                "device_id": self.device_id,
                "clock": self.clock.block(),
                "batch_seq": self.imu_seq,
                "sensor": "mpu6050",
                "sample_rate_hz": rate_hz,
                "accel_range_g": 8,
                "gyro_range_dps": 1000,
                "units": {"time": "ms_since_boot", "accel": "g", "gyro": "deg_per_s"},
                "samples": {k: [r[j] for r in part] for j, k in enumerate(("uptime_ms", "ax", "ay", "az", "gx", "gy", "gz"))},
            }
            results.append(self._ok("imu batch", *self.client.call("POST", "/api/device/v1/imu-batches", body), allowed=(200, 201)))
            self.imu_seq += 1
        return results

    def trigger(self, trigger_id: str, triggered_uptime_ms: int, capture_id: str | None) -> dict[str, Any]:
        body = {
            "schema_version": "imu-event.v2",
            "source_mode": "simulated",
            "device_id": self.device_id,
            "clock": self.clock.block(),
            "trigger": {
                "trigger_id": trigger_id,
                "trigger_type": "impact",
                "triggered_uptime_ms": triggered_uptime_ms,
                "firmware_rule_version": "test-harness",
                "capture_id": capture_id,
                "device_metrics": None,
            },
        }
        return self._ok("trigger", *self.client.call("POST", "/api/device/v1/imu-events", body), allowed=(200, 201))

    def ack(self, command_id: str, status: str, reason: str | None = None) -> tuple[int, Any]:
        body = {"schema_version": "command-status.v2", "device_id": self.device_id, "clock": self.clock.block(), "status": status, "reason_code": reason, "detail": None}
        return self.client.call("POST", f"/api/device/v1/commands/{command_id}/status", body)

    def fetch_audio(self, audio: dict[str, Any], part_bytes: int = 16_384) -> bytes:
        """Downloads only the audio referenced by the active command, in ranges, and verifies its SHA-256."""
        data = bytearray()
        while len(data) < audio["byte_size"]:
            end = min(len(data) + part_bytes, audio["byte_size"]) - 1
            status, chunk, headers = self.client.call_raw("GET", audio["path"], headers={"Range": f"bytes={len(data)}-{end}"})
            if status != 206:
                raise RuntimeError(f"audio range failed: {status}")
            data += chunk
        if hashlib.sha256(bytes(data)).hexdigest() != audio["sha256"]:
            raise RuntimeError("audio_integrity_failed")
        return bytes(data)

    def play_next_command(self) -> dict[str, Any]:
        """One poll of the documented protocol. Playback is simulated (no speaker)."""
        status, body = self.client.call("GET", "/api/device/v1/commands/next")
        if status == 204:
            return {"command": None, "acks": []}
        acks: list[tuple[str, int]] = []
        for cid in body.get("cancel_command_ids", []):
            acks.append(("cancelled", self.ack(cid, "cancelled", "cancel_requested")[0]))
        cmd = body.get("command")
        if cmd is None:
            return {"command": None, "acks": acks}
        audio = cmd["action"].get("audio")
        played = None
        if audio:
            try:
                played = self.fetch_audio(audio)
            except RuntimeError:
                acks.append(("rejected", self.ack(cmd["command_id"], "rejected", "audio_integrity_failed")[0]))
                return {"command": cmd, "acks": acks}
        for step in ("accepted", "started", "completed"):
            code, _ = self.ack(cmd["command_id"], step)
            acks.append((step, code))
            if code != 200:
                break
        return {"command": cmd, "acks": acks, "audio_bytes": len(played) if played else 0}


def load_frames(sample_dir: Path, extra_dir: Path | None, mode: str) -> list[bytes]:
    frames = [f.read_bytes() for f in sorted(sample_dir.glob("*.jpg"))]
    if len(frames) != 24:
        raise SystemExit(f"{sample_dir} must hold 24 JPEG frames (has {len(frames)})")
    if mode == "triggered":
        if extra_dir is None:
            raise SystemExit("--mode triggered needs --extra-sample-dir (40 frames = 24 + 16, a composed test input)")
        extra = [f.read_bytes() for f in sorted(extra_dir.glob("*.jpg"))][:16]
        if len(extra) != 16:
            raise SystemExit(f"{extra_dir} must hold at least 16 JPEG frames")
        frames += extra
    return frames


def synthetic_tone_wav(seconds: float = 1.0, rate: int = 16_000) -> bytes:
    """A 440 Hz test tone as 16-bit mono PCM WAV (no voice, no person). Legacy format: uploads are refused since ADR-025."""
    n = int(seconds * rate)
    pcm = b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(n))
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def synthetic_silent_mp3(seconds: float = 1.0) -> bytes:
    """Silent MP3 (MPEG-2 Layer III, 16 kHz mono, 32 kbps CBR): valid frame headers with an empty payload, built with the
    standard library only. The Worker walks the frame headers and this harness never decodes, so no encoder is needed;
    the real device decodes real LAME files (firmware/carelens-esp32s3/test/fixtures/mp3)."""
    frame_bytes = 72_000 * 32 // 16_000  # 144
    frame = bytes([0xFF, 0xF3, 0x48, 0xC0]) + bytes(frame_bytes - 4)  # sync, MPEG-2, Layer III, no CRC; 32 kbps, 16 kHz; mono
    frames = math.ceil(seconds * 16_000 / 576)
    return frame * frames


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--token-env", default="CARELENS_TEST_DEVICE_TOKEN")
    ap.add_argument("--device-id", required=True)
    ap.add_argument("--sample-dir", type=Path)
    ap.add_argument("--extra-sample-dir", type=Path)
    ap.add_argument("--mode", choices=["normal", "triggered"], default="normal")
    ap.add_argument("--capture-id")
    ap.add_argument("--imu", action="store_true", help="send synthetic raw IMU covering the burst (and a firmware trigger in triggered mode)")
    ap.add_argument("--commands", action="store_true", help="poll once and acknowledge a pending command")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args(argv)
    token = os.environ.get(a.token_env, "")
    if not token:
        raise SystemExit(f"set {a.token_env} to a device token of the local test backend")
    device = HarnessDevice(DeviceClient(a.api_url, token), a.device_id, seed=a.seed)
    print(json.dumps(device.heartbeat()))
    if a.sample_dir:
        frames = load_frames(a.sample_dir, a.extra_sample_dir, a.mode)
        capture_id = a.capture_id or f"cap-sample-{int(time.time())}"
        trigger_id = f"trg-{capture_id}" if a.mode == "triggered" else None
        first = device.clock.uptime_ms() - len(frames) * FRAME_INTERVAL_MS - 500
        if a.imu:
            device.send_imu(first - 5000, device.clock.uptime_ms() - 10)
            if trigger_id:
                print(json.dumps(device.trigger(trigger_id, first + 12 * FRAME_INTERVAL_MS, capture_id)))
        print(json.dumps(device.upload_capture(capture_id, frames, a.mode, trigger_id, first)))
    if a.commands:
        print(json.dumps(device.play_next_command(), default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
