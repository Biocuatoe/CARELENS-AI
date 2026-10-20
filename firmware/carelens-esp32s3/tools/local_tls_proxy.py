"""HTTPS front for the LOCAL backend so the physical device can test with real TLS on the home network.

Listens on one private LAN address only (never 0.0.0.0, never a VPN interface, no router port forwarding) with the server
certificate from local_e2e_setup.py, and forwards ONLY the device API (/api/device/v1/...) and /health to the local
wrangler dev backend on 127.0.0.1:8787. The device verifies this certificate against the provisioned local test CA and the
LAN IP in its subjectAltName; nothing is skipped. Logs hold method, path, status, size and duration: never headers,
tokens or bodies (frames, audio).

Usage: python tools/local_tls_proxy.py [--secrets D:/AI/Cache/carelens-device/secrets.local.json] [--log file]
"""
from __future__ import annotations

import argparse
import http.client
import ipaddress
import json
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BACKEND = ("127.0.0.1", 8787)
ALLOWED_PREFIX = "/api/device/v1/"
MAX_BODY = 2 * 1024 * 1024
FORWARD_REQUEST = ("authorization", "content-type", "range", "accept", "user-agent")
HOP = {"connection", "keep-alive", "transfer-encoding", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade", "content-length"}
_log_lock = threading.Lock()
_log_file = None

# Test-only fault injection (local E2E failure tests). Faults come from a JSON file next to the secrets, are applied at most
# once each, and every application is logged as "FAULT". Keys: corrupt_audio (flip one byte of an audio range), audio_status
# (e.g. 410 instead of the audio), drop_status_response (a status word, e.g. "completed": forward it, but answer 502 once),
# corrupt_chunk (flip one byte of the next capture chunk), delay_next_ms (delay one commands/next answer).
_faults_path: Path | None = None
_faults: dict = {}
_faults_mtime = 0.0
_faults_lock = threading.Lock()


def take_fault(name: str, match=None):
    """Returns the fault's value and marks it used, or None. With `match`, only a fault whose value equals it is used."""
    global _faults, _faults_mtime
    if _faults_path is None:
        return None
    with _faults_lock:
        try:
            mtime = _faults_path.stat().st_mtime
        except OSError:
            return None
        if mtime != _faults_mtime:
            _faults_mtime = mtime
            try:
                _faults = json.loads(_faults_path.read_text(encoding="utf-8"))
            except ValueError:
                _faults = {}
        if match is not None and _faults.get(name) != match:
            return None
        return _faults.pop(name, None)


def log(line: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    with _log_lock:
        print(f"{stamp} {line}", flush=True)
        if _log_file:
            _log_file.write(f"{stamp} {line}\n")
            _log_file.flush()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "carelens-local-tls-proxy"
    timeout = 60

    def log_message(self, fmt: str, *args) -> None:  # silence the default access log (it would print the full request line)
        return

    def _deny(self, status: int, text: str) -> None:
        body = json.dumps({"code": text}).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _forward(self) -> None:
        t0 = time.time()
        path = self.path.split("?", 1)[0]
        if not (path.startswith(ALLOWED_PREFIX) or path == "/health"):
            log(f"{self.command} {path} -> 404 (not forwarded: only the device API is exposed)")
            self._deny(404, "not_exposed")
            return
        length = int(self.headers.get("content-length") or 0)
        if length > MAX_BODY:
            self._deny(413, "too_large")
            self.close_connection = True
            return
        body = self.rfile.read(length) if length else None
        if body and self.command == "PUT" and "/chunks/" in path and take_fault("corrupt_chunk"):
            body = body[:100] + bytes([body[100] ^ 0xFF]) + body[101:]
            log(f"FAULT corrupt_chunk: flipped byte 100 of {path}")
        if self.command == "GET" and path.endswith("/audio"):
            status = take_fault("audio_status")
            if status:
                log(f"FAULT audio_status: answering {status} for {path}")
                self._deny(int(status), "injected_fault")
                return
        if path.endswith("/commands/next"):
            delay = take_fault("delay_next_ms")
            if delay:
                log(f"FAULT delay_next_ms: holding {path} for {delay} ms")
                time.sleep(int(delay) / 1000)
        headers = {k: v for k, v in self.headers.items() if k.lower() in FORWARD_REQUEST}
        conn = http.client.HTTPConnection(*BACKEND, timeout=60)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
        except OSError as e:
            log(f"{self.command} {path} -> 502 backend unreachable ({e.__class__.__name__})")
            self._deny(502, "backend_unreachable")
            return
        finally:
            conn.close()
        if path.endswith("/status") and body:
            try:
                word = json.loads(body).get("status")
            except ValueError:
                word = None
            if word and take_fault("drop_status_response", match=word) == word:
                log(f"FAULT drop_status_response: backend answered {resp.status} to '{word}' on {path}; the device gets 502")
                self._deny(502, "injected_fault")
                return
        if resp.status == 206 and path.endswith("/audio") and data and take_fault("corrupt_audio"):
            data = data[:60] + bytes([data[60] ^ 0xFF]) + data[61:]
            log(f"FAULT corrupt_audio: flipped byte 60 of the range served for {path}")
        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)
        log(f"{self.command} {path} -> {resp.status} in={length} out={len(data)} {int((time.time() - t0) * 1000)}ms")

    do_GET = _forward
    do_POST = _forward
    do_PUT = _forward


def main() -> int:
    global _log_file, _faults_path
    ap = argparse.ArgumentParser()
    ap.add_argument("--secrets", type=Path, default=Path(r"D:\AI\Cache\carelens-device\secrets.local.json"))
    ap.add_argument("--log", type=Path)
    ap.add_argument("--faults", type=Path, help="test-only fault injection file (see take_fault)")
    a = ap.parse_args()
    _faults_path = a.faults
    cfg = json.loads(a.secrets.read_text(encoding="utf-8"))
    ip, port, tls = cfg["lan_ip"], int(cfg["port"]), Path(cfg["tls_dir"])
    if not ipaddress.ip_address(ip).is_private:
        raise SystemExit("refusing a non-private listen address")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(tls / "server.pem", tls / "server.key")
    server = ThreadingHTTPServer((ip, port), Handler)
    server.daemon_threads = True
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    if a.log:
        _log_file = a.log.open("a", encoding="utf-8")
    log(f"listening on https://{ip}:{port} (LAN only) -> http://{BACKEND[0]}:{BACKEND[1]}, exposing {ALLOWED_PREFIX}* and /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
