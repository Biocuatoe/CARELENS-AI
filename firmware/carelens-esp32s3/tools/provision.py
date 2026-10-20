"""Provision the device over UART0 (CH343 port) from the local secrets file, without printing any secret.

Sends `prov begin`, one `prov set <key> <base64>` per value, `prov commit`, then `reboot` (unless --no-reboot). Values travel
base64-encoded on the local serial cable only; the firmware never echoes them and replies with lengths. The secrets file is
written by local_e2e_setup.py (or by hand) and lives outside the repository.

Usage: python tools/provision.py [--port COM6] [--secrets file] [--keys ssid,pass,api,device,token,ca] [--set vol=0.4]
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from pathlib import Path

import serial

KEYS = {"ssid": "wifi_ssid", "pass": "wifi_pass", "api": "api_base", "device": "device_id", "token": "token"}


def b64(s: str) -> str:
    return base64.b64encode(s.encode("utf-8")).decode("ascii")


def send(ser: serial.Serial, line: str, label: str, secrets: list[str]) -> bool:
    ser.reset_input_buffer()
    ser.write((line + "\n").encode("ascii"))
    deadline = time.time() + 4
    buf = b""
    while time.time() < deadline:
        buf += ser.read(512)
        for raw in buf.split(b"\n"):
            text = raw.decode("utf-8", "replace").strip()
            for s in secrets:
                text = text.replace(s, "[REDACTED]")
            if "console: OK" in text or "console: ERR" in text:
                print(f"{label}: {text.split('console: ', 1)[1]}")
                return "console: OK" in text
    print(f"{label}: no reply")
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM6")
    ap.add_argument("--secrets", type=Path, default=Path(r"D:\AI\Cache\carelens-device\secrets.local.json"))
    ap.add_argument("--keys", default="ssid,pass,api,device,token,ca")
    ap.add_argument("--set", action="append", default=[], help="extra non-secret key=value (capint, vol, trig, imuhz)")
    ap.add_argument("--no-reboot", action="store_true")
    a = ap.parse_args()
    cfg = json.loads(a.secrets.read_text(encoding="utf-8"))
    secrets = [v for k, v in cfg.items() if k in ("wifi_pass", "token", "wifi_ssid") and isinstance(v, str) and len(v) >= 4]
    ser = serial.Serial()
    ser.port, ser.baudrate, ser.timeout = a.port, 115200, 0.1
    ser.dtr = False
    ser.rts = False
    ser.open()
    ok = send(ser, "prov begin", "begin", secrets)
    for key in [k.strip() for k in a.keys.split(",") if k.strip()]:
        if key == "ca":
            pem = Path(cfg["ca_pem_file"]).read_text(encoding="ascii") if cfg.get("ca_pem_file") else ""
            ok &= send(ser, f"prov set ca {b64(pem)}" if pem else "prov set ca", "ca", secrets)
            continue
        value = cfg.get(KEYS[key], "")
        ok &= send(ser, f"prov set {key} {b64(value)}", key, secrets)
    for kv in a.set:
        k, _, v = kv.partition("=")
        ok &= send(ser, f"prov set {k} {b64(v)}", k, secrets)
    if not ok:
        send(ser, "prov abort", "abort", secrets)
        ser.close()
        print("provisioning aborted: nothing was written")
        return 1
    ok = send(ser, "prov commit", "commit", secrets)
    if ok and not a.no_reboot:
        send(ser, "reboot", "reboot", secrets)
    ser.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
