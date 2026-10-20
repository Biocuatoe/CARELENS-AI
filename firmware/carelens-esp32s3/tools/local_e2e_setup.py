"""Prepare a LOCAL end-to-end test of the physical device against the local backend (wrangler dev on 127.0.0.1:8787).

Refuses any backend that is not on loopback. Never prints a secret. Writes, outside the repository:
  <secrets dir>/secrets.local.json   Wi-Fi (read from the protected baseline copy), device id/token, api base, CA path,
                                     local viewer login (generated password)
  <secrets dir>/tls/                 a local test CA and a server certificate for this PC's LAN address (EC P-256)
and, inside the git-ignored agent folder, integrations/carelens/local-agent/agent.env (agent token, local backend URL).

Steps (each idempotent): recipient rcp-showcase, device (created, or its token rotated), agent (new), viewer caregiver with a
viewer grant and a password, TLS material. Admin calls use the local static development token
(backend/care-monitoring/worker/.wrangler/dev-admin-token.txt, created by dev_setup.py init).

Usage: python tools/local_e2e_setup.py --lan-ip 192.168.1.12 [--device-id esp32s3-chest-01]
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
API = "http://127.0.0.1:8787"
ADMIN_TOKEN_FILE = REPO / "backend" / "care-monitoring" / "worker" / ".wrangler" / "dev-admin-token.txt"
AGENT_ENV = REPO / "integrations" / "carelens" / "local-agent" / "agent.env"
BASELINE = Path(r"D:\AI\Cache\carelens-fw-baseline-check\src\main.cpp")  # protected local copy holding the Wi-Fi settings
RECIPIENT = "rcp-showcase"


def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    token = ADMIN_TOKEN_FILE.read_text(encoding="utf-8").strip()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Authorization": f"Bearer {token}", **({"Content-Type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def wifi_from_baseline() -> tuple[str, str]:
    text = BASELINE.read_text(encoding="utf-8")
    ssid = re.search(r'^const char\* WIFI_SSID = "([^"]*)";', text, re.M)
    pw = re.search(r'^const char\* WIFI_PASS = "([^"]*)";', text, re.M)
    if not ssid or not pw or ssid.group(1).startswith("CHANGE_ME"):
        raise SystemExit("Wi-Fi settings not found in the protected baseline copy")
    return ssid.group(1), pw.group(1)


def make_tls(out: Path, lan_ip: str) -> Path:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    out.mkdir(parents=True, exist_ok=True)
    ca_cert_path, ca_key_path = out / "local-test-ca.pem", out / "local-test-ca.key"
    now = dt.datetime.now(dt.timezone.utc)
    if ca_cert_path.is_file() and ca_key_path.is_file():
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), None)
        ca_cert = x509.load_pem_x509_certificate(ca_cert_path.read_bytes())
    else:
        ca_key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "CareLens local test CA (not for production)")])
        ca_cert = (
            x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True, content_commitment=False, key_encipherment=False, data_encipherment=False, key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
            .sign(ca_key, hashes.SHA256())
        )
        ca_key_path.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        ca_cert_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, lan_ip)]))
        .issuer_name(ca_cert.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=90))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(lan_ip))]), critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    (out / "server.key").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (out / "server.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return ca_cert_path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lan-ip", required=True, help="this PC's private LAN address the device reaches (no public address)")
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--device-id", default="esp32s3-chest-01")
    ap.add_argument("--secrets-dir", type=Path, default=Path(r"D:\AI\Cache\carelens-device"))
    a = ap.parse_args()
    if not ipaddress.ip_address(a.lan_ip).is_private:
        raise SystemExit("refusing: --lan-ip must be a private address (the backend is never exposed publicly)")
    if not ADMIN_TOKEN_FILE.is_file():
        raise SystemExit("local admin token missing: run backend/care-monitoring/scripts/dev_setup.py init")

    s, out = call("POST", "/api/admin/v1/recipients", {"recipient_id": RECIPIENT, "display_label": "Hồ sơ trình diễn", "timezone": "Asia/Ho_Chi_Minh"})
    if s not in (201, 409):
        raise SystemExit(f"recipient: HTTP {s} {out.get('code')}")
    s, out = call("POST", "/api/admin/v1/devices", {"device_id": a.device_id, "recipient_id": RECIPIENT, "label": "Hộp đeo ngực ESP32-S3 (thiết bị thật)"})
    if s == 409:
        s, out = call("POST", f"/api/admin/v1/devices/{a.device_id}/rotate-token", {})
    if s not in (200, 201) or not str(out.get("token", "")).startswith("cld_"):
        raise SystemExit(f"device: HTTP {s} {out.get('code')}")
    device_token = out["token"]
    s, out = call("POST", "/api/admin/v1/agents", {"label": "PC local agent (E2E)"})
    if s != 201 or not str(out.get("token", "")).startswith("cla_"):
        raise SystemExit(f"agent: HTTP {s} {out.get('code')}")
    agent_token, agent_id = out["token"], out.get("agent_id")

    secrets_dir = a.secrets_dir
    secrets_dir.mkdir(parents=True, exist_ok=True)
    path = secrets_dir / "secrets.local.json"
    state = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    viewer_login = "localviewer"
    viewer_password = state.get("viewer_password") or secrets.token_urlsafe(18)
    user_id = state.get("viewer_user_id")
    if user_id:
        s, out = call("POST", f"/api/admin/v1/caregivers/{user_id}/login", {"login_id": viewer_login, "password": viewer_password})
        if s == 404:
            user_id = None
    if not user_id:
        s, cg = call("POST", "/api/admin/v1/caregivers", {"display_name": "Người xem thử cục bộ", "token_expires_in_days": 1})
        if s != 201:
            raise SystemExit(f"caregiver: HTTP {s} {cg.get('code')}")
        user_id = cg["user_id"]
        call("POST", f"/api/admin/v1/caregiver-tokens/{cg['token_id']}/revoke", {})
        s, out = call("POST", "/api/admin/v1/grants", {"user_id": user_id, "recipient_id": RECIPIENT, "role": "viewer"})
        if s not in (201, 409):
            raise SystemExit(f"grant: HTTP {s} {out.get('code')}")
        s, out = call("POST", f"/api/admin/v1/caregivers/{user_id}/login", {"login_id": viewer_login, "password": viewer_password})
    if s != 201:
        raise SystemExit(f"viewer login: HTTP {s} {out.get('code')}")

    ssid, wifi_pass = wifi_from_baseline()
    ca = make_tls(secrets_dir / "tls", a.lan_ip)
    state.update({
        "note": "Local end-to-end test secrets. Never commit, share or upload. Device token and Wi-Fi password are secrets.",
        "wifi_ssid": ssid, "wifi_pass": wifi_pass,
        "api_base": f"https://{a.lan_ip}:{a.port}", "device_id": a.device_id, "token": device_token,
        "ca_pem_file": str(ca), "tls_dir": str(secrets_dir / "tls"), "lan_ip": a.lan_ip, "port": a.port,
        "viewer_login": viewer_login, "viewer_password": viewer_password, "viewer_user_id": user_id, "agent_id": agent_id,
    })
    path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    AGENT_ENV.write_text(
        "# Written by firmware/carelens-esp32s3/tools/local_e2e_setup.py for the LOCAL backend only. Git-ignored; never commit.\n"
        f"CARELENS_BACKEND_URL={API}\nCARELENS_AGENT_TOKEN={agent_token}\nCARELENS_VISION_URL=http://127.0.0.1:8080\nCARELENS_OLLAMA_URL=http://127.0.0.1:11434\n"
        "CARELENS_SUMMARY_MODEL=qwen3:4b-instruct-2507-q4_K_M\nCARELENS_PACKAGE_VERSION=carelens_models_v1_20261018\n",
        encoding="utf-8",
    )
    print(f"recipient {RECIPIENT}: ok; device {a.device_id}: token issued (stored, not shown); agent {agent_id}: token stored in agent.env")
    print(f"viewer login '{viewer_login}': password stored in {path} (not shown)")
    print(f"TLS: local test CA + server certificate for {a.lan_ip} in {secrets_dir / 'tls'}; device api_base https://{a.lan_ip}:{a.port}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
