"""
Telegram bot for LIVESHOWCASE demo control.

Uses python-telegram-bot v22 async API. The polling loop runs in a daemon thread
(managed by Application.run_polling) so it does not block FastAPI startup.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
from typing import Final

# python-telegram-bot v22 is fully async
from telegram import BotCommand, Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    Defaults,
)

from . import state
from .sse import push_state_update

# ---------------------------------------------------------------------------
# Logging — bump PTB internal loggers to INFO so we see polling messages
# ---------------------------------------------------------------------------

log = logging.getLogger(__name__)
logging.getLogger("telegram.ext.Application").setLevel(logging.INFO)
logging.getLogger("telegram.ext.Updater").setLevel(logging.INFO)


def _mask_token(token: str | None) -> str:
    """Mask a Telegram bot token for safe logging."""
    if not token:
        return "none"
    if len(token) < 10:
        return "***"
    return token[:8] + "****" + token[-4:]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TELEGRAM_BOT_TOKEN: Final[str | None] = os.environ.get("TELEGRAM_BOT_TOKEN")
ALLOWED_CHAT_IDS: Final[frozenset[int]] = frozenset(
    int(x) for x in os.environ.get("ALLOWED_CHAT_IDS", "").split(",") if x.strip()
)
# Optional: if set, BOTH chat_id AND user_id must be in their respective sets.
ALLOWED_USER_IDS: Final[frozenset[int]] = frozenset(
    int(x) for x in os.environ.get("ALLOWED_USER_IDS", "").split(",") if x.strip()
)
TELEGRAM_ADMIN_CHAT_ID: Final[int | None] = int(os.environ["TELEGRAM_ADMIN_CHAT_ID"]) if os.environ.get("TELEGRAM_ADMIN_CHAT_ID") else None

BOT_IS_CONFIGURED: Final[bool] = bool(TELEGRAM_BOT_TOKEN and ALLOWED_CHAT_IDS)

# ---------------------------------------------------------------------------
# Command catalogue (sent to Telegram on startup via set_my_commands)
# ---------------------------------------------------------------------------

DEMO_COMMANDS: Final[list[tuple[str, str]]] = [
    # CareLens
    ("c_on", "Bật CareLens (online)"),
    ("c_off", "Tắt CareLens (offline)"),
    ("c_status", "Trạng thái CareLens + thiết bị/Telegram"),
    ("c_fall", "Mô phỏng ngã (critical, alert)"),
    ("c_low", "Mô phỏng tư thế thấp gần sàn (warning, alert)"),
    ("c_activity", "Mô phỏng người dùng đang hoạt động"),
    ("c_inactive", "Mô phỏng ít vận động (c_idle = alias)"),
    ("c_lying", "Mô phỏng đang nằm (no alert)"),
    ("c_water", "Ghi nhận đã uống nước"),
    ("c_medicine", "Ghi nhận đã uống thuốc"),
    # EcoPatch
    ("e_on", "Bật EcoPatch (online)"),
    ("e_off", "Tắt EcoPatch (offline)"),
    ("e_status", "Trạng thái EcoPatch + thiết bị/Telegram"),
    # System
    ("status", "Trạng thái backend + kết nối Telegram"),
    ("menu", "Hiển thị menu lệnh"),
]

MENU_TEXT: Final[str] = """\
📋 Day1Care Demo — Menu lệnh

CareLens:
 /c_on        — Bật CareLens (online)
 /c_off       — Tắt CareLens (offline)
 /c_status    — Trạng thái CareLens
 /c_fall      — Mô phỏng ngã (critical, tạo alert)
 /c_low       — Mô phỏng tư thế thấp (warning, tạo alert)
 /c_activity  — Mô phỏng đang hoạt động
 /c_inactive  — Mô phỏng ít vận động (alias: /c_idle)
 /c_lying     — Mô phỏng đang nằm (no alert)
 /c_water     — Ghi nhận đã uống nước
 /c_medicine  — Ghi nhận đã uống thuốc

EcoPatch:
 /e_on        — Bật EcoPatch (online)
 /e_off       — Tắt EcoPatch (offline)
 /e_status    — Trạng thái EcoPatch

Hệ thống:
 /status      — Trạng thái backend + Telegram
 /menu        — Hiển thị menu này
 /reset       — Đặt lại demo state

Lưu ý: BPM không bị Telegram sinh ra — EcoPatch chỉ điều khiển on/off.
"""


# ---------------------------------------------------------------------------
# Telegram → internal command mapping
# ---------------------------------------------------------------------------

TELEGRAM_TO_COMMAND: Final[dict[str, str]] = {
    # CareLens online/offline
    "/c_on": "carelens_online",
    "/c_off": "carelens_offline",
    # CareLens events
    "/c_fall": "carelens_event_fall",
    "/c_low": "carelens_event_posture",       # alias for low posture → posture event
    "/c_activity": "carelens_event_activity",
    "/c_inactive": "carelens_event_idle",
    "/c_idle": "carelens_event_idle",          # kept as alias per user decision
    "/c_lying": "carelens_event_lying",        # new
    # CareLens care notes
    "/c_water": "carelens_water",
    "/c_medicine": "carelens_medicine",
    # EcoPatch
    "/e_on": "ecopatch_online",
    "/e_off": "ecopatch_offline",
    # Demo
    "/reset": "reset",
}


# ---------------------------------------------------------------------------
# Authorization guard
# ---------------------------------------------------------------------------

def _is_authorized(chat_id: int, user_id: int | None = None) -> bool:
    """
    Check if the request is authorized.

    Rules (in order):
    - If ALLOWED_USER_IDS is set, user_id must be in the set.
    - chat_id must be in ALLOWED_CHAT_IDS.
    - If ALLOWED_USER_IDS is empty, only chat_id is checked.
    """
    if ALLOWED_CHAT_IDS and chat_id not in ALLOWED_CHAT_IDS:
        return False
    if ALLOWED_USER_IDS and (user_id is None or user_id not in ALLOWED_USER_IDS):
        return False
    return True


# ---------------------------------------------------------------------------
# Status helpers
# ---------------------------------------------------------------------------

def _format_carelens_status_line() -> dict:
    hub = state.DEVICES["d_hub_liveshowcase"]
    events = state.full_state()["events"]
    latest_event = events[-1] if events else None
    return {
        "online": hub.online,
        "last_seen_at": hub.last_seen_at,
        "latest_event_at": latest_event["observed_at"] if latest_event else None,
        "recipient_id": hub.recipient_id,
        "device_id": hub.id,
    }


def _format_ecopatch_status_line() -> dict:
    core = state.DEVICES["d_core_liveshowcase"]
    latest_data = core.latest_data
    heart_rate_summary = None
    if latest_data and latest_data.get("kind") == "heart_rate":
        heart_rate_summary = f"{latest_data.get('value')} bpm ({latest_data.get('quality', '?')})"
    return {
        "online": core.online,
        "last_seen_at": core.last_seen_at,
        "latest_measurement_summary": heart_rate_summary,
        "recipient_id": core.recipient_id,
        "device_id": core.id,
    }


# ---------------------------------------------------------------------------
# Update handlers
# ---------------------------------------------------------------------------

async def _start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Respond with the menu text for /start and /menu."""
    if not update.effective_chat:
        return
    user = update.effective_user
    log.info("TRACE /start chat_id=%s user_id=%s msg=%r",
             update.effective_chat.id, user.id if user else None,
             getattr(update.message, 'text', None))
    log.info("TRACE _is_authorized chat_id=%s user_id=%s allowed_chats=%s allowed_users=%s result=%s",
             update.effective_chat.id, user.id if user else None,
             sorted(ALLOWED_CHAT_IDS), sorted(ALLOWED_USER_IDS),
             _is_authorized(update.effective_chat.id, user.id if user else None))
    if not _is_authorized(update.effective_chat.id, user.id if user else None):
        # Silent for unauthorized — log at DEBUG only
        log.debug("Unauthorized /start from chat_id=%s", update.effective_chat.id)
        return
    if update.message:
        await update.message.reply_text(MENU_TEXT, parse_mode="HTML")


async def _menu_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Respond with the menu text for /menu."""
    await _start_handler(update, context)


async def _c_status_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with CareLens device status."""
    if not update.effective_chat or not update.message:
        return
    user = update.effective_user
    if not _is_authorized(update.effective_chat.id, user.id if user else None):
        log.debug("Unauthorized /c_status from chat_id=%s", update.effective_chat.id)
        return

    info = _format_carelens_status_line()
    text = (
        f"📡 CareLens — Trạng thái\n"
        f" Hồ sơ: Demo trực tiếp ({info['recipient_id']})\n"
        f" Thiết bị: {info['device_id']}\n"
        f" Trạng thái: {'online' if info['online'] else 'offline'}\n"
        f" Lần cuối thấy: {info['last_seen_at'] or 'chưa có'}\n"
        f" Sự kiện mới nhất: {info['latest_event_at'] or 'chưa có'}\n"
        f" Telegram user_id: {user.id if user else 'không rõ'}\n"
        f" Telegram chat_id: {update.effective_chat.id}"
    )
    await update.message.reply_text(text)


async def _e_status_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with EcoPatch device status."""
    if not update.effective_chat or not update.message:
        return
    user = update.effective_user
    if not _is_authorized(update.effective_chat.id, user.id if user else None):
        log.debug("Unauthorized /e_status from chat_id=%s", update.effective_chat.id)
        return

    info = _format_ecopatch_status_line()
    text = (
        f"💓 EcoPatch — Trạng thái\n"
        f" Hồ sơ: Demo trực tiếp ({info['recipient_id']})\n"
        f" Thiết bị: {info['device_id']}\n"
        f" Trạng thái: {'online' if info['online'] else 'offline'}\n"
        f" Lần cuối thấy: {info['last_seen_at'] or 'chưa có'}\n"
        f" Đo mới nhất: {info['latest_measurement_summary'] or 'chưa có'}\n"
        f" Telegram user_id: {user.id if user else 'không rõ'}\n"
        f" Telegram chat_id: {update.effective_chat.id}"
    )
    await update.message.reply_text(text)


async def _status_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Reply with full system status."""
    if not update.effective_chat or not update.message:
        return
    user = update.effective_user
    if not _is_authorized(update.effective_chat.id, user.id if user else None):
        log.debug("Unauthorized /status from chat_id=%s", update.effective_chat.id)
        return

    cl_info = _format_carelens_status_line()
    ep_info = _format_ecopatch_status_line()
    text = (
        f"🏥 Day1Care Demo — Trạng thái hệ thống\n\n"
        f" Hồ sơ: Demo trực tiếp (r_liveshowcase)\n\n"
        f" 📡 CareLens\n"
        f" Trạng thái: {'online' if cl_info['online'] else 'offline'}\n"
        f" Thiết bị: {cl_info['device_id']}\n\n"
        f" 💓 EcoPatch\n"
        f" Trạng thái: {'online' if ep_info['online'] else 'offline'}\n"
        f" Thiết bị: {ep_info['device_id']}\n\n"
        f" 👤 Telegram\n"
        f" user_id: {user.id if user else 'không rõ'}\n"
        f" chat_id: {update.effective_chat.id}\n\n"
        f" 🌐 Backend\n"
        f" Health: OK\n"
        f" Polling: ACTIVE\n"
        f" SSE: ACTIVE"
    )
    await update.message.reply_text(text)


async def _demo_command_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Dispatch demo commands to the state machine.
    Silently ignores unknown commands and unauthorized users.
    """
    if not update.effective_chat or not update.message:
        return

    chat_id = update.effective_chat.id
    user = update.effective_user
    user_id = user.id if user else None

    if not _is_authorized(chat_id, user_id):
        log.warning("[TELEGRAM] UNAUTHORIZED chat_id=%s user_id=%s (allowed=%s, allowed_users=%s)",
                    chat_id, user_id, sorted(ALLOWED_CHAT_IDS), sorted(ALLOWED_USER_IDS))
        return

    raw = update.message.text or ""
    if not raw.startswith("/"):
        log.warning("[TELEGRAM] NOT_A_COMMAND chat_id=%s user_id=%s text=%r", chat_id, user_id, raw)
        return

    # Extract command token (strip args if any)
    parts = raw.lstrip("/").split(None, 1)
    token = "/" + parts[0].lower()

    # /start and /menu are handled separately
    if token in ("/start", "/menu"):
        await _start_handler(update, context)
        return

    internal_cmd = TELEGRAM_TO_COMMAND.get(token)
    log.info("[TELEGRAM_ROUTE] token=%s chat_id=%s user_id=%s internal_cmd=%s",
             token, chat_id, user_id, internal_cmd)
    if internal_cmd is None:
        log.warning("[TELEGRAM] UNKNOWN_COMMAND token=%s chat_id=%s user_id=%s", token, chat_id, user_id)
        return

    try:
        result = state.apply_command(internal_cmd, source="telegram")
        log.info("[TELEGRAM] apply_command %s → %s (chat_id=%s) seq=%s", token, internal_cmd, chat_id, result["seq"])
        await push_state_update()
        log.info("[TELEGRAM] push_state_update done, broadcast sent")
    except Exception as exc:
        log.error("Error applying command %s: %s", internal_cmd, exc)


# ---------------------------------------------------------------------------
# Polling loop — runs in a daemon thread
# ---------------------------------------------------------------------------

def _run_polling_thread(application: Application) -> None:
    """
    Target for the daemon thread. Calls run_polling() which blocks until
    Application.stop() is called from the main asyncio event loop.
    python-telegram-bot v22 handles its own loop and exception recovery internally.
    """
    try:
        application.run_polling(
            allowed_updates=["message"],
            drop_pending_updates=True,
            close_loop=False,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("Telegram polling thread crashed: %s", exc)


# ---------------------------------------------------------------------------
# Startup / shutdown helpers (called from app.py lifespan)
# ---------------------------------------------------------------------------

async def start_telegram_bot() -> Application | None:
    """
    Initialise and start the Telegram bot.

    Returns the Application on success, or None if the bot is not configured
    (no token or no allowed chat IDs — this is not an error in demo mode).
    """
    if not BOT_IS_CONFIGURED:
        log.warning(
            "Telegram bot not configured: set TELEGRAM_BOT_TOKEN and ALLOWED_CHAT_IDS "
            "in the environment to enable it."
        )
        return None

    log.info("Telegram bot: initialising with token prefix=%s...", _mask_token(TELEGRAM_BOT_TOKEN))

    defaults = Defaults(parse_mode="HTML")
    assert TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN must be set when BOT_IS_CONFIGURED is True"
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).defaults(defaults).build()

    # Register handlers
    application.add_handler(CommandHandler("start", _start_handler))
    application.add_handler(CommandHandler("menu", _menu_handler))
    application.add_handler(CommandHandler("c_status", _c_status_handler))
    application.add_handler(CommandHandler("e_status", _e_status_handler))
    application.add_handler(CommandHandler("status", _status_handler))
    # NOTE: each command must be registered exactly once. Duplicates cause the FIRST
    # registration to win, so c_on/c_off in the loop would be shadowed by the individual
    # registrations above. Keep this list in sync with TELEGRAM_TO_COMMAND.
    for cmd in ["e_on", "e_off", "c_on", "c_off", "c_inactive", "c_idle", "c_low", "c_lying", "c_fall", "c_activity", "c_water", "c_medicine", "reset"]:
        application.add_handler(CommandHandler(cmd, _demo_command_handler))

    # Register menu commands with Telegram
    try:
        await application.bot.set_my_commands([
            BotCommand(command=cmd, description=desc) for cmd, desc in DEMO_COMMANDS
        ])
        log.info("Telegram bot commands registered.")
    except Exception as exc:  # noqa: BLE001
        log.warning("Failed to register Telegram bot commands: %s", exc)

    # Initialize the application (required before polling).
    # NOTE: do NOT call application.start() here — run_polling() manages its own
    # internal start/stop cycle. Calling start() then run_polling() causes
    # "This Application is already running!" which silently kills the polling thread.
    await application.initialize()
    log.info("TRACE Application built; bot.username=%s", (await application.bot.get_me()).username)

    # Start polling in a daemon thread. run_polling() blocks in that thread
    # and calls Application.stop() when interrupted, which unblocks the main loop.
    log.info("TRACE polling thread starting; token=%s", _mask_token(TELEGRAM_BOT_TOKEN))
    polling_thread = threading.Thread(
        target=_run_polling_thread,
        args=(application,),
        name="telegram_polling",
        daemon=True,
    )
    polling_thread.start()
    log.info("TRACE polling thread started; alive=%s name=%s", polling_thread.is_alive(), polling_thread.name)

    # Wait for first getMe to succeed before sending startup notification
    for attempt in range(5):
        try:
            me = await application.bot.get_me()
            log.info("Telegram bot verified: @%s", me.username)
            break
        except Exception as exc:  # noqa: BLE001
            wait = 2 ** attempt
            log.warning("Telegram getMe attempt %d failed: %s. Retrying in %ds.", attempt + 1, exc, wait)
            await asyncio.sleep(wait)
    else:
        log.error("Telegram bot: could not verify credentials after 5 attempts. Bot not started.")
        return None

    # Startup confirmation to admin
    if TELEGRAM_ADMIN_CHAT_ID:
        try:
            await application.bot.send_message(
                chat_id=TELEGRAM_ADMIN_CHAT_ID,
                text=(
                    "✅ Day1Care Demo Backend connected to Telegram successfully.\n"
                    "Bot is online and ready for demo commands.\n"
                    f"Allowed chat IDs: {', '.join(str(x) for x in sorted(ALLOWED_CHAT_IDS))}"
                ),
            )
            # Log with masked token — NEVER log the actual token
            log.info(
                "Telegram startup confirmation sent to admin chat_id=%s (token=%s)",
                TELEGRAM_ADMIN_CHAT_ID,
                _mask_token(TELEGRAM_BOT_TOKEN),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Failed to send Telegram startup confirmation: %s", exc)

    return application


async def stop_telegram_bot(application: Application | None) -> None:
    """Gracefully stop the Telegram polling loop."""
    if application is None:
        return
    try:
        await application.stop()
        log.info("Telegram bot stopped.")
    except Exception as exc:  # noqa: BLE001
        log.warning("Error stopping Telegram bot: %s", exc)
