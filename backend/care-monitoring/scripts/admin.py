"""Provisioning helper for the care-monitoring admin API (standard library only).

The admin token is read from the environment variable CARELENS_ADMIN_TOKEN (never from arguments, so it
does not land in shell history). New credentials are printed once; store them where they belong
(device secure storage, the agent's agent.env, the caregiver's password manager).

  set CARELENS_ADMIN_TOKEN=...        (PowerShell: $env:CARELENS_ADMIN_TOKEN = '...')
  python scripts/admin.py --api https://care-monitoring.<sub>.workers.dev recipient --label "Bà A" [--id rcp-1]
  python scripts/admin.py --api ... device --id esp32-cam-01 --recipient rcp-1 --label "Camera phòng ngủ"
  python scripts/admin.py --api ... agent --label "PC tại nhà"
  python scripts/admin.py --api ... caregiver --name "Người chăm sóc" [--days 365]
  python scripts/admin.py --api ... grant --user usr_... --recipient rcp-1 --role caregiver|viewer
  python scripts/admin.py --api ... login --user usr_... --login-id giamkhao@example.com   (web sign-in; the server generates the password; rotates)
  python scripts/admin.py --api ... login --user usr_... --login-id DAYONE --choose-password   (you type the password at a hidden prompt)
  python scripts/admin.py --api ... google-allow --user usr_... --email judge@example.com   (authorize one Google identity for that account)
  python scripts/admin.py --api ... google-revoke --email judge@example.com                 (remove it; existing sessions are kept)
  python scripts/admin.py --api ... revoke-token --id tok_...     (an API token printed by `caregiver`)
  python scripts/admin.py --api ... revoke-grant --id grt_...     (ends access to that recipient, closes streams)
  python scripts/admin.py --api ... status

Judges / viewers: create one dedicated caregiver for the judging panel, revoke the API token that `caregiver`
prints (the web sign-in does not need it), grant the `viewer` role on the showcase recipient only, then issue
a login. The generated password is shown once; give it over a private channel. Every sign-in is its own
session, so the judges can share the account at the same time. After the demo: `revoke-grant`, then `login`
again (rotates the password and ends every session) and keep the new password to yourself.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request


def call(api: str, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    token = os.environ.get("CARELENS_ADMIN_TOKEN", "")
    if not token:
        raise SystemExit("set CARELENS_ADMIN_TOKEN")
    req = urllib.request.Request(api.rstrip("/") + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", **({"Content-Type": "application/json"} if body is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def main() -> int:
    # Vietnamese labels and results must print on a Windows console that defaults to cp1252.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("recipient")
    r.add_argument("--label", required=True)
    r.add_argument("--id")
    r.add_argument("--timezone", default="Asia/Ho_Chi_Minh")
    d = sub.add_parser("device")
    d.add_argument("--id", required=True)
    d.add_argument("--recipient", required=True)
    d.add_argument("--label", required=True)
    g = sub.add_parser("agent")
    g.add_argument("--label", required=True)
    c = sub.add_parser("caregiver")
    c.add_argument("--name", required=True)
    c.add_argument("--days", type=int)
    gr = sub.add_parser("grant")
    gr.add_argument("--user", required=True)
    gr.add_argument("--recipient", required=True)
    gr.add_argument("--role", choices=["caregiver", "viewer"], required=True)
    lg = sub.add_parser("login")
    lg.add_argument("--user", required=True)
    lg.add_argument("--login-id", "--email", dest="login_id", required=True, help="e-mail address or plain user name (case-insensitive)")
    lg.add_argument("--choose-password", action="store_true", help="read an owner-chosen password from a hidden prompt (or CARELENS_LOGIN_PASSWORD) instead of generating one")
    ga = sub.add_parser("google-allow")
    ga.add_argument("--user", required=True)
    ga.add_argument("--email", required=True, help="the Google account's verified e-mail address")
    gv = sub.add_parser("google-revoke")
    gv.add_argument("--email", required=True)
    rt = sub.add_parser("revoke-token")
    rt.add_argument("--id", required=True)
    rg = sub.add_parser("revoke-grant")
    rg.add_argument("--id", required=True)
    sub.add_parser("status")
    a = ap.parse_args()
    if a.cmd == "recipient":
        status, out = call(a.api, "POST", "/api/admin/v1/recipients", {"recipient_id": a.id, "display_label": a.label, "timezone": a.timezone})
    elif a.cmd == "device":
        status, out = call(a.api, "POST", "/api/admin/v1/devices", {"device_id": a.id, "recipient_id": a.recipient, "label": a.label})
    elif a.cmd == "agent":
        status, out = call(a.api, "POST", "/api/admin/v1/agents", {"label": a.label})
    elif a.cmd == "caregiver":
        status, out = call(a.api, "POST", "/api/admin/v1/caregivers", {"display_name": a.name, "token_expires_in_days": a.days})
    elif a.cmd == "grant":
        status, out = call(a.api, "POST", "/api/admin/v1/grants", {"user_id": a.user, "recipient_id": a.recipient, "role": a.role})
    elif a.cmd == "login":
        body: dict = {"login_id": a.login_id}
        if a.choose_password:
            # Never an argument: it would land in shell history and process listings.
            password = os.environ.get("CARELENS_LOGIN_PASSWORD") or getpass.getpass("Password for the account (hidden): ")
            body["password"] = password
        status, out = call(a.api, "POST", f"/api/admin/v1/caregivers/{a.user}/login", body)
    elif a.cmd == "google-allow":
        status, out = call(a.api, "POST", f"/api/admin/v1/caregivers/{a.user}/google", {"email": a.email})
    elif a.cmd == "google-revoke":
        status, out = call(a.api, "POST", "/api/admin/v1/google/revoke", {"email": a.email})
    elif a.cmd == "revoke-token":
        status, out = call(a.api, "POST", f"/api/admin/v1/caregiver-tokens/{a.id}/revoke")
    elif a.cmd == "revoke-grant":
        status, out = call(a.api, "POST", f"/api/admin/v1/grants/{a.id}/revoke")
    else:
        status, out = call(a.api, "GET", "/api/admin/v1/status")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if status < 400 else 1


if __name__ == "__main__":
    sys.exit(main())
