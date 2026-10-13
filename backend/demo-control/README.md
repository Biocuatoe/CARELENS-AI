# Demo Control Backend

## Purpose

HTTP backend for the LIVESHOWCASE demo persona. Receives device toggle commands (via Telegram webhook or curl), maintains in-memory device state, and broadcasts state changes via SSE to connected browser sessions.

**Scope**: single-instance in-memory state for `r_liveshowcase`. No database, no auth, no persistence across restarts.

## Running locally

```powershell
# Install dependencies (one-time)
python -m pip install fastapi uvicorn pydantic pytest httpx

# Start the server
cd D:\IStartup-main\backend\demo-control
python -m uvicorn demo_control.app:app --host 127.0.0.1 --port 8787 --reload
```

Server starts at `http://127.0.0.1:8787`. Open http://127.0.0.1:8787/docs for the Swagger UI.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/demo/stream` | SSE stream; emit full state on connect, then diffs on each state change |
| `GET` | `/api/demo/state` | Current state snapshot (JSON, for debugging) |
| `POST` | `/api/demo/command` | Apply a command: `carelens_online`, `carelens_offline`, `ecopatch_online`, `ecopatch_offline` |
| `POST` | `/api/demo/telegram/webhook` | **Optional.** Telegram Bot webhook. Translates `/carelens_online`, `/carelens_offline`, `/ecopatch_online`, `/ecopatch_offline` to internal commands. See §Telegram below. |

## Testing

```powershell
cd D:\IStartup-main\backend\demo-control
python -m pytest -q
```

## Telegram integration (optional)

If you have a Telegram bot token:

```powershell
$env = @{
    TELEGRAM_BOT_TOKEN = "your_token_here"
    TELEGRAM_WEBHOOK_SECRET = "your_secret_here"  # optional, used as X-Telegram-Bot-Api-Secret-Token header
}
```

Register your webhook with Telegram:

```powershell
curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook --data-urlencode "url=https://your-public-url/api/demo/telegram/webhook"
```

Supported commands:
- `/carelens_online` → CareLens hub goes online
- `/carelens_offline` → CareLens hub goes offline
- `/ecopatch_online` → EcoPatch core goes online
- `/ecopatch_offline` → EcoPatch core goes offline

## State model

```
d_hub_liveshowcase  (carelens_hub)
d_core_liveshowcase (ecopatch_core)

online: bool
signal: "connected" | "offline"
last_seen_at: ISO8601 | null   (set when going online, null when offline)
latest_data: HubState | HeartRateData | null
```

`latest_data` is always null when `online = false`. When `online = true`:
- CareLens: `{kind: "hub_status", summary: "AI ghi nhận hoạt động bình thường.", observed_at: now}`
- EcoPatch: `{kind: "heart_rate", value: <synthetic 60–100 bpm>, unit: "bpm", quality: "fair", observed_at: now}`

## Local curl test (no Telegram needed)

```powershell
# Check current state
curl http://127.0.0.1:8787/api/demo/state

# Turn CareLens online
curl -X POST http://127.0.0.1:8787/api/demo/command -H "Content-Type: application/json" -d "{\"cmd\":\"carelens_online\"}"

# Turn EcoPatch offline
curl -X POST http://127.0.0.1:8787/api/demo/command -H "Content-Type: application/json" -d "{\"cmd\":\"ecopatch_offline\"}"

# Simulate Telegram update
curl -X POST http://127.0.0.1:8787/api/demo/telegram/webhook -H "Content-Type: application/json" -d "{\"message\":{\"text\":\"/carelens_online\",\"chat\":{\"id\":123456}}}"
```
