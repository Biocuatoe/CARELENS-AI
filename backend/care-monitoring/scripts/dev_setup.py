"""Local development setup for the Live Demo sign-in (standard library only; local backend only).

  1. python backend/care-monitoring/scripts/dev_setup.py init
       Creates worker/.dev.vars (gitignored) from .dev.vars.example with a fresh admin token digest, and keeps the
       admin token in worker/.wrangler/dev-admin-token.txt (gitignored). Refuses to touch an existing .dev.vars.
  2. npm run dev:backend            (restart it after `init`, wrangler reads .dev.vars at start)
  3. python backend/care-monitoring/scripts/dev_setup.py provision --login-id DAYONE
       Through the real admin API: showcase recipient, a viewer account, its grant, and the web sign-in. The
       password is read from a hidden prompt (or CARELENS_LOGIN_PASSWORD), never from an argument, and is stored
       by the server only as a salted hash. Safe to run again: it re-issues the sign-in (and ends old sessions).
  4. npm run dev                    → http://localhost:5173/login

This only ever talks to a loopback address. Production provisioning is docs/DEPLOYMENT_RUNBOOK.md §8.1.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from admin import call  # noqa: E402

WORKER = Path(__file__).resolve().parents[1] / "worker"
DEV_VARS = WORKER / ".dev.vars"
EXAMPLE = WORKER / ".dev.vars.example"
TOKEN_FILE = WORKER / ".wrangler" / "dev-admin-token.txt"
STATE_FILE = WORKER / ".wrangler" / "dev-setup.json"
RECIPIENT_ID = "rcp-showcase"


def init() -> int:
    if DEV_VARS.exists():
        print(f"{DEV_VARS} already exists; not changing it. It must hold ADMIN_TOKEN_SHA256 and the local ALLOWED_ORIGINS.")
        return 0
    token = "cl-admin-" + secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    lines = []
    for line in EXAMPLE.read_text(encoding="utf-8").splitlines():
        lines.append(f"ADMIN_TOKEN_SHA256={digest}" if line.startswith("ADMIN_TOKEN_SHA256=") else line)
    DEV_VARS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
    print(f"created {DEV_VARS.name} and {TOKEN_FILE.relative_to(WORKER)} (both gitignored). Restart the backend to pick them up.")
    return 0


def loopback(api: str) -> None:
    host = urlparse(api).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"refusing {api}: this helper is for the local backend only (use docs/DEPLOYMENT_RUNBOOK.md §8.1 for production)")


def provision(api: str, login_id: str) -> int:
    loopback(api)
    if not TOKEN_FILE.is_file():
        raise SystemExit("no local admin token; run `dev_setup.py init` first (or set CARELENS_ADMIN_TOKEN yourself)")
    os.environ.setdefault("CARELENS_ADMIN_TOKEN", TOKEN_FILE.read_text(encoding="utf-8").strip())
    password = os.environ.get("CARELENS_LOGIN_PASSWORD") or getpass.getpass(f"Password for {login_id} (hidden): ")
    if len(password) < 5:
        raise SystemExit("the password must have at least 5 characters")

    status, out = call(api, "POST", "/api/admin/v1/recipients", {"recipient_id": RECIPIENT_ID, "display_label": "Hồ sơ trình diễn", "timezone": "Asia/Ho_Chi_Minh"})
    if status not in (201, 409):
        raise SystemExit(f"recipient: HTTP {status} {out}")

    state = json.loads(STATE_FILE.read_text(encoding="utf-8")) if STATE_FILE.is_file() else {}
    user_id = state.get("user_id")
    if user_id:
        status, out = call(api, "POST", f"/api/admin/v1/caregivers/{user_id}/login", {"login_id": login_id, "password": password})
        if status == 404:  # the local database was reset since the last run
            user_id = None
    if not user_id:
        status, cg = call(api, "POST", "/api/admin/v1/caregivers", {"display_name": "Ban giám khảo", "token_expires_in_days": 1})
        if status != 201:
            raise SystemExit(f"caregiver: HTTP {status} {cg}")
        user_id = cg["user_id"]
        # The viewer signs in on the web only; its API token is not needed.
        call(api, "POST", f"/api/admin/v1/caregiver-tokens/{cg['token_id']}/revoke")
        status, out = call(api, "POST", "/api/admin/v1/grants", {"user_id": user_id, "recipient_id": RECIPIENT_ID, "role": "viewer"})
        if status not in (201, 409):
            raise SystemExit(f"grant: HTTP {status} {out}")
        status, out = call(api, "POST", f"/api/admin/v1/caregivers/{user_id}/login", {"login_id": login_id, "password": password})
    if status != 201:
        raise SystemExit(f"login: HTTP {status} {out}")
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"user_id": user_id}), encoding="utf-8")
    print(f"ready: sign in at /login with account '{login_id}' (viewer on {RECIPIENT_ID}); the password was not stored anywhere but the server's salted hash.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    p = sub.add_parser("provision")
    p.add_argument("--api", default="http://127.0.0.1:8787")
    p.add_argument("--login-id", required=True)
    a = ap.parse_args()
    return init() if a.cmd == "init" else provision(a.api, a.login_id)


if __name__ == "__main__":
    sys.exit(main())
