"""LOCAL development only: a one-time admin sign-in link for the admin dashboard without Google.

Production admins sign in with Google (ADR-020). On a development PC without Google OAuth credentials this writes, into the
LOCAL D1 database of `wrangler dev` (worker/.wrangler/state), an active admin row (role `admin`, e-mail
local-dev-admin@carelens.invalid) and a single-use 10-minute exchange code - exactly what the Google callback would have
stored - and saves the sign-in URL (#admin_code=cax_…) to worker/.wrangler/dev-admin-login-url.txt (git-ignored). The web
app then trades the code for a normal `clm_` session through the real POST /api/admin/v1/session/exchange.

Never touches a remote database: it always passes --local and --persist-to. Nothing secret is printed.
Usage: python backend/care-monitoring/scripts/dev_admin_login.py [--web http://localhost:5173]
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

WORKER = Path(__file__).resolve().parents[1] / "worker"
STATE = WORKER / ".wrangler" / "state"
OUT = WORKER / ".wrangler" / "dev-admin-login-url.txt"
ADMIN_ID = "adm_localdev"
EMAIL = "local-dev-admin@carelens.invalid"


def iso(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--web", default="http://localhost:5173", help="the local web app (Vite dev server)")
    a = ap.parse_args()
    if not a.web.startswith(("http://localhost:", "http://127.0.0.1:")):
        raise SystemExit("refusing: this helper is for a local web app only")
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx or not STATE.is_dir():
        raise SystemExit("needs npx and a local wrangler state (run the local backend once)")
    code = "cax_" + secrets.token_urlsafe(32)
    now = dt.datetime.now(dt.timezone.utc)
    sql = (
        f"INSERT OR IGNORE INTO admins (admin_id, email, role, status, created_at) VALUES ('{ADMIN_ID}', '{EMAIL}', 'admin', 'active', '{iso(now)}'); "
        f"UPDATE admins SET status = 'active' WHERE admin_id = '{ADMIN_ID}'; "
        f"INSERT INTO admin_login_exchanges (code_sha256, admin_id, auth_at, created_at, expires_at) VALUES "
        f"('{hashlib.sha256(code.encode()).hexdigest()}', '{ADMIN_ID}', '{iso(now)}', '{iso(now)}', '{iso(now + dt.timedelta(minutes=10))}');"
    )
    r = subprocess.run([npx, "wrangler", "d1", "execute", "care_monitoring", "--local", "--persist-to", str(STATE), "--command", sql],
                       cwd=WORKER, capture_output=True, text=True, encoding="utf-8", errors="replace", env={**__import__("os").environ, "WRANGLER_SEND_METRICS": "false", "CI": "1"})
    if r.returncode != 0:
        print(r.stderr[-800:], file=sys.stderr)
        return r.returncode
    OUT.write_text(f"{a.web}/admin/login#admin_code={code}\n", encoding="utf-8")
    print(f"one-time admin sign-in link (valid 10 minutes, single use) written to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
