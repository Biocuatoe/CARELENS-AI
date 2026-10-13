"""
Day1Care backend launcher.

Loads .env into os.environ before any other import, fails loud if Telegram is
not properly configured, then runs uvicorn on 127.0.0.1:8787.

Launch from an interactive shell OR via scripts/start_backend_detached.bat for
a fully orphaned process that survives Cursor agent / shell exit.
"""
import os
import sys
from pathlib import Path

# Load .env before anything else
env_path = Path(__file__).parent / ".env"
loaded_vars = 0
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip()
            loaded_vars += 1
    print(f"[start_backend] loaded {loaded_vars} vars from {env_path}")
else:
    print(f"[start_backend] WARNING: {env_path} not found", file=sys.stderr)

# Fail loud if Telegram is not properly configured.
# Without these, the bot silently skips startup — this guard prevents that regression.
_tg_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
if _tg_token == "dummy" or not _tg_token:
    print(
        "[start_backend] FATAL: TELEGRAM_BOT_TOKEN is missing or 'dummy'. "
        "Edit backend/demo-control/.env or run via a launcher that sources it. "
        "Refusing to start so the silent-no-polling regression cannot recur.",
        file=sys.stderr,
    )
    sys.exit(2)

os.environ["PYTHONIOENCODING"] = "utf-8"

# Add src/ to sys.path so demo_control module is importable
src_path = Path(__file__).parent / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

import uvicorn
uvicorn.run("demo_control.app:app", host="127.0.0.1", port=8787, log_level="info", access_log=False)
