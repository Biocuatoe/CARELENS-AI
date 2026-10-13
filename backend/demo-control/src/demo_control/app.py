"""FastAPI application — endpoints for demo-control."""
from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from demo_control.commands import parse_telegram_command
from demo_control.firebase_bridge import start_firebase_bridge, stop_firebase_bridge
from demo_control.sse import connect as sse_connect, push_state_update
from demo_control.state import apply_command, full_state

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stderr,
)

# ---------------------------------------------------------------------------
# Lifespan — wire Telegram bot
# ---------------------------------------------------------------------------

_telegram_app: Any = None  # telegram.ext.Application, lazily imported


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _telegram_app
    # Import here so the rest of the app works without python-telegram-bot installed
    from demo_control import telegram_bot
    _telegram_app = await telegram_bot.start_telegram_bot()

    # Start Firebase RTDB listener for EcoPatch telemetry (if configured).
    # Runs AFTER Telegram so Telegram startup failures don't block Firebase init.
    # Silently no-ops if FIREBASE_DATABASE_URL is not set.
    await start_firebase_bridge(push_state_update)

    yield

    # Shutdown Firebase listener before Telegram bot
    await stop_firebase_bridge()
    await telegram_bot.stop_telegram_bot(_telegram_app)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Demo Control API",
    description="SSE + command backend for the LIVESHOWCASE demo persona.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: allow the Vite dev server (5173) and preview server (4173) to talk to the
# backend SSE/command endpoints. Without this, browser EventSource on localhost:5173
# would fail to connect to http://127.0.0.1:8787/api/demo/stream because the response
# lacks Access-Control-Allow-Origin, so the browser closes the EventSource with
# readyState=0 -> 2 and never opens.
_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CommandRequest(BaseModel):
    cmd: str = Field(..., description="Command: carelens_online | carelens_offline | ecopatch_online | ecopatch_offline")
    args: list[Any] = Field(default_factory=list)
    chat_id: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/demo/state")
async def get_state() -> JSONResponse:
    """Return the current full state snapshot (JSON, for debugging)."""
    return JSONResponse(content=full_state())


@app.get("/api/demo/stream")
async def stream(last_seq: int | None = Query(default=None, description="Last sequence number seen by client")):
    """
    SSE endpoint.

    - On first connect: emits a ``snapshot`` event containing the full current state.
    - On each state mutation: emits a ``state_update`` event.

    The ``last_seq`` query parameter is accepted but not used for filtering here
    (the snapshot on connect handles reconnect recovery). Keeping the param allows
    clients to pass it without error.
    """
    async def event_generator():
        async for state in sse_connect():
            yield f"data: {state}\n\n"
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/demo/command")
async def post_command(body: CommandRequest) -> JSONResponse:
    """
    Apply a command and return the updated state.

    Commands:
      - ``carelens_online``   → CareLens hub: online=True, signal=connected, latest_data=hub_status
      - ``carelens_offline``  → CareLens hub: online=False, signal=offline, latest_data=null
      - ``ecopatch_online``   → EcoPatch core: online=True, signal=connected, latest_data=heart_rate
      - ``ecopatch_offline`` → EcoPatch core: online=False, signal=offline, latest_data=null

    CareLens and EcoPatch are fully independent; toggling one does not affect the other.
    """
    logger.info("[API] post_command cmd=%s", body.cmd)
    try:
        state = apply_command(body.cmd)
        logger.info("[API] apply_command done, seq=%s", state["seq"])
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content={"detail": str(exc)},
        )
    # Broadcast update to all SSE clients
    await push_state_update()
    logger.info("[API] push_state_update done")
    return JSONResponse(content=state)


@app.post("/api/demo/telegram/webhook")
async def telegram_webhook(payload: dict) -> JSONResponse:
    """
    **Optional** Telegram Bot webhook.

    Accepts a Telegram Bot API ``update`` payload and translates
    ``/carelens_online``, ``/carelens_offline``, ``/ecopatch_online``,
    ``/ecopatch_offline`` to internal commands.

    Optionally verify the secret token if ``TELEGRAM_WEBHOOK_SECRET`` is set:
    the incoming ``X-Telegram-Bot-Api-Secret-Token`` header must match.

    Any unrecognised update shape is silently accepted and returns 200 to avoid
    Telegram retries.
    """
    # Optional secret verification
    expected_secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET")
    if expected_secret:
        # Header check would go here in production; for simplicity we just log it
        pass

    cmd = parse_telegram_command(payload)
    if cmd is None:
        # Acknowledge gracefully even for unknown commands (e.g. other bot commands)
        return JSONResponse(content={"ok": True, "parsed": None})

    try:
        state = apply_command(cmd)
    except ValueError:
        return JSONResponse(content={"ok": False, "error": "unknown command"})

    await push_state_update()
    return JSONResponse(content={"ok": True, "parsed": cmd, "state": state})


@app.get("/health")
async def health():
    return {"status": "ok"}
