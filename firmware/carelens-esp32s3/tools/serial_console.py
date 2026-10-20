"""Capture the firmware's UART0 log (COM port of the CH343 bridge) and optionally send console commands.

The port is opened with DTR and RTS released so opening it does not reset the board; --reset pulses EN through RTS
(classic auto-reset wiring: RTS asserted with DTR released pulls EN low). Any secret listed in the local secrets
file (--secrets, default: CARELENS_DEVICE_SECRETS or D:/AI/Cache/carelens-device/secrets.local.json) is redacted
before a line is printed or written, as a second line of defence: the firmware itself never prints secrets.

Usage:
  python tools/serial_console.py --seconds 20 [--reset] [--cmd status --cmd selftest] [--cmd-delay 3] [--log out.log]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import serial

DEFAULT_SECRETS = Path(os.environ.get("CARELENS_DEVICE_SECRETS", r"D:\AI\Cache\carelens-device\secrets.local.json"))


def load_secrets(path: Path) -> list[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [v for k, v in data.items() if k in ("wifi_pass", "token", "wifi_ssid") and isinstance(v, str) and len(v) >= 4]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM6")
    ap.add_argument("--seconds", type=float, default=15)
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--cmd", action="append", default=[])
    ap.add_argument("--cmd-delay", type=float, default=2.0, help="seconds before the first command and between commands")
    ap.add_argument("--log", type=Path)
    ap.add_argument("--secrets", type=Path, default=DEFAULT_SECRETS)
    ap.add_argument("--quiet", action="store_true", help="only write the log file")
    args = ap.parse_args()
    secrets = load_secrets(args.secrets)

    ser = serial.Serial()
    ser.port, ser.baudrate, ser.timeout = args.port, 115200, 0.1
    ser.dtr = False
    ser.rts = False
    ser.open()
    if args.reset:
        ser.rts = True
        time.sleep(0.15)
        ser.rts = False
    start = time.time()
    pending = list(args.cmd)
    next_cmd = start + args.cmd_delay
    out = args.log.open("w", encoding="utf-8", newline="\n") if args.log else None
    boots = 0
    buf = b""

    def emit(text: str) -> None:
        nonlocal boots
        for s in secrets:
            text = text.replace(s, "[REDACTED]")
        if "ESP-ROM:" in text:
            boots += 1
        line = f"{time.time() - start:8.2f}  {text}"
        if not args.quiet:
            print(line, flush=True)
        if out:
            out.write(line + "\n")
            out.flush()

    try:
        while time.time() - start < args.seconds:
            if pending and time.time() >= next_cmd:
                cmd = pending.pop(0)
                ser.write((cmd + "\n").encode("utf-8"))
                emit(f"<<< sent command: {cmd.split(' ')[0]}")
                next_cmd = time.time() + args.cmd_delay
            buf += ser.read(4096)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                emit(line.decode("utf-8", "replace").rstrip("\r"))
        if buf:
            emit(buf.decode("utf-8", "replace"))
    finally:
        ser.close()
        if out:
            out.write(f"# end: {args.seconds:.0f} s, ROM boot banners seen: {boots}\n")
            out.close()
    print(f"# captured {args.seconds:.0f} s, ROM boot banners: {boots}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
