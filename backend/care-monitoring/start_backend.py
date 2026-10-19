"""care-monitoring local launcher (kept so `npm run dev:backend` from the repo root keeps working).

Runs the Cloudflare Worker locally with `wrangler dev` on 127.0.0.1:8787 (the port the frontend's development
build expects), with local D1/R2/Durable Object state under worker/.wrangler/state. Applies pending D1
migrations first. Secrets and local overrides come from worker/.dev.vars (see worker/.dev.vars.example);
nothing is printed. Requires `npm ci` once in worker/. Never contacts a Cloudflare account.

Migration 0001 was revised in place before the first deployment. Wrangler only tracks migration names, so a
local database created from an earlier revision would keep the old schema: the launcher records a digest of
every applied migration file and refuses to start when an applied file changed. `--reset-local-db` deletes
the local development database (worker/.wrangler/state/v3/d1) and recreates it; nothing else is touched.

The former in-memory FastAPI service that lived here was replaced by the Worker (ADR-016).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

WORKER = Path(__file__).resolve().parent / "worker"
STATE = WORKER / ".wrangler" / "state"
MARKER = STATE / "carelens-migrations.json"
LOCAL_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"


def migration_digests() -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((WORKER / "migrations").glob("*.sql"))}


def stale_migrations() -> list[str]:
    """Names of migrations applied to the local database from a different file revision."""
    if not MARKER.is_file():
        return []
    try:
        applied = json.loads(MARKER.read_text(encoding="utf-8"))
    except ValueError:
        return []
    current = migration_digests()
    return [name for name, digest in applied.items() if current.get(name) not in (None, digest)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run the care-monitoring Worker locally (wrangler dev).")
    ap.add_argument("--reset-local-db", action="store_true", help="delete the local development D1 database and recreate it from the migrations")
    args = ap.parse_args(argv)
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if npx is None:
        print("[start_backend] npx not found: install Node.js 24+", file=sys.stderr)
        return 2
    if not (WORKER / "node_modules").is_dir():
        print("[start_backend] run `npm ci` in backend/care-monitoring/worker first", file=sys.stderr)
        return 2
    local_d1 = STATE / "v3" / "d1"
    if args.reset_local_db:
        shutil.rmtree(local_d1, ignore_errors=True)
        MARKER.unlink(missing_ok=True)
        print("[start_backend] local development database removed; it will be recreated from the migrations")
    elif local_d1.is_dir() and not MARKER.is_file():
        print("[start_backend] the local database predates the schema check; run `python start_backend.py --reset-local-db` once (local test data only)", file=sys.stderr)
        return 3
    changed = stale_migrations()
    if changed:
        print(f"[start_backend] local database was created from an older revision of {', '.join(changed)}; run `python start_backend.py --reset-local-db` (local test data only)", file=sys.stderr)
        return 3
    # The deployed Worker is Google-only (PASSWORD_SIGN_IN=disabled in wrangler.jsonc); local development keeps the
    # owner-issued passwords that dev_setup.py provisions.
    extra: list[str] = ["--var", "PASSWORD_SIGN_IN:enabled"]
    if not (WORKER / ".dev.vars").is_file():
        print("[start_backend] worker/.dev.vars not found: copy .dev.vars.example (admin API stays disabled until ADMIN_TOKEN_SHA256 is set)", file=sys.stderr)
        # Local only (wrangler dev binds 127.0.0.1): let the Vite dev/preview servers open the stream.
        extra += ["--var", f"ALLOWED_ORIGINS:{LOCAL_ORIGINS}", "--var", "ENVIRONMENT:development"]
    env = {**os.environ, "WRANGLER_SEND_METRICS": "false", "CI": "1"}
    migrate = subprocess.run([npx, "wrangler", "d1", "migrations", "apply", "care_monitoring", "--local", "--persist-to", str(STATE)], cwd=WORKER, env=env)
    if migrate.returncode != 0:
        print("[start_backend] local D1 migration failed", file=sys.stderr)
        return migrate.returncode
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps(migration_digests(), indent=1), encoding="utf-8")
    port = os.environ.get("PORT", "8787")
    return subprocess.call([npx, "wrangler", "dev", "--ip", "127.0.0.1", "--port", port, "--persist-to", str(STATE), "--test-scheduled", *extra], cwd=WORKER, env={**env, "CI": ""})


if __name__ == "__main__":
    sys.exit(main())
