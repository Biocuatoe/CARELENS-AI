"""Command parser from Telegram payloads."""
from __future__ import annotations

from typing import Any


def parse_telegram_command(payload: dict[str, Any]) -> str | None:
    """
    Extract a demo command from a Telegram Bot API update payload.

    Handles:
      - ``{"message": {"text": "/carelens_online", ...}}``
      - ``{"edited_message": {"text": "/ecopatch_offline", ...}}``
      - Any other update structure → None

    Returns the command string (e.g. ``"carelens_online"``) or None if no
    recognised command is found.
    """
    message = payload.get("message") or payload.get("edited_message")
    if not message:
        return None
    text = message.get("text", "").strip()
    if not text.startswith("/"):
        return None
    # Strip leading slash and map Telegram-style names to internal command names.
    command_map = {
        "carelens_online": "carelens_online",
        "carelens_offline": "carelens_offline",
        "ecopatch_online": "ecopatch_online",
        "ecopatch_offline": "ecopatch_offline",
    }
    return command_map.get(text.lstrip("/"))
