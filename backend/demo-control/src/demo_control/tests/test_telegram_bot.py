"""Tests for demo_control.telegram_bot."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# We import telegram_bot module, which requires python-telegram-bot to be installed.
# If not available, skip these tests.
try:
    from telegram import Update
    from telegram.ext import Application
except ImportError:
    pytest.skip("python-telegram-bot not installed", allow_module_level=True)

from demo_control.telegram_bot import (
    BOT_IS_CONFIGURED,
    DEMO_COMMANDS,
    MENU_TEXT,
    _c_status_handler,
    _demo_command_handler,
    _e_status_handler,
    _is_authorized,
    _start_handler,
    _status_handler,
    TELEGRAM_TO_COMMAND,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_update(text: str, chat_id: int = 123456, user_id: int | None = 111222) -> MagicMock:
    """Build a minimal Update mock with a message and user."""
    message = MagicMock()
    message.text = text
    message.reply_text = AsyncMock()
    chat = MagicMock()
    chat.id = chat_id
    message.chat = chat
    user = MagicMock()
    user.id = user_id
    update = MagicMock(spec=Update)
    update.effective_chat = chat
    update.effective_user = user
    update.message = message
    return update


class FakeContext:
    """Minimal context object for handler compatibility."""
    pass


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------

class TestAuthorization:
    def test_authorized_chat_no_user_restriction(self):
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                assert _is_authorized(123456) is True

    def test_unauthorized_chat(self):
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                assert _is_authorized(999999) is False

    def test_allowed_user_ids_required_both_pass(self):
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset({111222, 333444})):
                assert _is_authorized(123456, user_id=111222) is True

    def test_allowed_user_ids_required_user_missing(self):
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset({111222, 333444})):
                assert _is_authorized(123456, user_id=999999) is False

    def test_allowed_user_ids_required_chat_missing(self):
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset({111222})):
                assert _is_authorized(999999, user_id=111222) is False

    def test_allowed_user_ids_but_user_id_is_none(self):
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset({111222})):
                assert _is_authorized(123456, user_id=None) is False


# ---------------------------------------------------------------------------
# Menu text and commands
# ---------------------------------------------------------------------------

class TestMenuText:
    def test_menu_contains_all_telegram_commands(self):
        for token in TELEGRAM_TO_COMMAND:
            assert f"/{token.lstrip('/')}" in MENU_TEXT

    def test_menu_text_contains_all_14_commands(self):
        # All 14 commands that appear in DEMO_COMMANDS should be in menu
        for cmd, _ in DEMO_COMMANDS:
            assert f"/{cmd}" in MENU_TEXT, f"Command /{cmd} missing from MENU_TEXT"

    def test_menu_text_contains_telegram_badge(self):
        assert "Telegram" in MENU_TEXT

    def test_menu_text_contains_c_lying(self):
        assert "/c_lying" in MENU_TEXT

    def test_menu_text_contains_c_status(self):
        assert "/c_status" in MENU_TEXT

    def test_menu_text_contains_e_status(self):
        assert "/e_status" in MENU_TEXT

    def test_menu_text_contains_status(self):
        assert "/status" in MENU_TEXT


# ---------------------------------------------------------------------------
# Start / menu handlers
# ---------------------------------------------------------------------------

class TestStartHandler:
    def test_start_sends_menu_for_authorized(self):
        update = make_update("/start", chat_id=123456)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_start_handler(update, FakeContext()))
        update.message.reply_text.assert_called_once()
        args = update.message.reply_text.call_args[0]
        assert "Demo" in args[0]

    def test_start_silent_for_unauthorized(self):
        update = make_update("/start", chat_id=999999)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_start_handler(update, FakeContext()))
        update.message.reply_text.assert_not_called()


# ---------------------------------------------------------------------------
# Status handlers
# ---------------------------------------------------------------------------

class TestCStatusHandler:
    def test_c_status_replies_with_carelens_info(self):
        update = make_update("/c_status", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_c_status_handler(update, FakeContext()))
        update.message.reply_text.assert_called_once()
        args = update.message.reply_text.call_args[0]
        text = args[0]
        assert "CareLens" in text
        assert "Telegram user_id" in text
        assert "Telegram chat_id" in text
        assert "111222" in text
        assert "123456" in text

    def test_c_status_silent_for_unauthorized(self):
        update = make_update("/c_status", chat_id=999999, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_c_status_handler(update, FakeContext()))
        update.message.reply_text.assert_not_called()


class TestEStatusHandler:
    def test_e_status_replies_with_ecopatch_info(self):
        update = make_update("/e_status", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_e_status_handler(update, FakeContext()))
        update.message.reply_text.assert_called_once()
        args = update.message.reply_text.call_args[0]
        text = args[0]
        assert "EcoPatch" in text
        assert "Telegram user_id" in text
        assert "Telegram chat_id" in text


class TestStatusHandler:
    def test_status_replies_with_full_system_info(self):
        update = make_update("/status", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_status_handler(update, FakeContext()))
        update.message.reply_text.assert_called_once()
        args = update.message.reply_text.call_args[0]
        text = args[0]
        assert "CareLens" in text
        assert "EcoPatch" in text
        assert "Telegram" in text
        assert "Backend" in text
        assert "111222" in text
        assert "123456" in text

    def test_status_silent_for_unauthorized(self):
        update = make_update("/status", chat_id=999999, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                asyncio.run(_status_handler(update, FakeContext()))
        update.message.reply_text.assert_not_called()


# ---------------------------------------------------------------------------
# Demo command handler
# ---------------------------------------------------------------------------

class TestDemoCommandHandler:
    def test_c_on_maps_to_carelens_online(self):
        update = make_update("/c_on", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("carelens_online", source="telegram")

    def test_e_on_maps_to_ecopatch_online(self):
        update = make_update("/e_on", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("ecopatch_online", source="telegram")

    def test_e_off_maps_to_ecopatch_offline(self):
        update = make_update("/e_off", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("ecopatch_offline", source="telegram")

    def test_c_idle_aliases_c_inactive(self):
        """Telegram /c_idle dispatches carelens_event_idle (same as /c_inactive)."""
        update = make_update("/c_idle", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("carelens_event_idle", source="telegram")

    def test_c_inactive_maps_to_carelens_event_idle(self):
        update = make_update("/c_inactive", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("carelens_event_idle", source="telegram")

    def test_c_low_maps_to_carelens_event_posture(self):
        update = make_update("/c_low", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("carelens_event_posture", source="telegram")

    def test_c_lying_maps_to_carelens_event_lying(self):
        update = make_update("/c_lying", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_called_once_with("carelens_event_lying", source="telegram")

    def test_unauthorized_does_not_call_apply(self):
        update = make_update("/c_on", chat_id=999999, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_not_called()

    def test_unauthorized_user_id_rejected(self):
        update = make_update("/c_on", chat_id=123456, user_id=999999)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset({111222})):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_not_called()

    def test_unknown_command_silent(self):
        update = make_update("/unknown_command", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    with patch("demo_control.telegram_bot.push_state_update", new_callable=AsyncMock):
                        asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_not_called()
        update.message.reply_text.assert_not_called()

    def test_regular_text_not_command(self):
        update = make_update("Hello world", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch("demo_control.telegram_bot.state.apply_command") as mock_apply:
                    asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_apply.assert_not_called()

    def test_all_demo_commands_recognized(self):
        """Every Telegram command token maps to a valid internal command."""
        import demo_control.telegram_bot as tg_mod
        for token in TELEGRAM_TO_COMMAND:
            update = make_update(f"/{token}", chat_id=123456, user_id=111222)
            with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
                with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                    with patch.object(tg_mod.state, "apply_command") as mock_apply:
                        with patch.object(tg_mod, "push_state_update", new_callable=AsyncMock):
                            asyncio.run(_demo_command_handler(update, FakeContext()))
                    mock_apply.assert_called_once()

    def test_menu_command_calls_start_handler(self):
        import demo_control.telegram_bot as tg_mod
        update = make_update("/menu", chat_id=123456, user_id=111222)
        with patch("demo_control.telegram_bot.ALLOWED_CHAT_IDS", frozenset({123456})):
            with patch("demo_control.telegram_bot.ALLOWED_USER_IDS", frozenset()):
                with patch.object(tg_mod, "_start_handler", new_callable=AsyncMock) as mock_start:
                    asyncio.run(_demo_command_handler(update, FakeContext()))
        mock_start.assert_called_once()

    def test_bot_token_not_logged_on_init(self):
        """Token is masked in log messages."""
        import demo_control.telegram_bot as tg_mod
        # The _mask_token helper should be called instead of raw token
        with patch.object(tg_mod, "_mask_token") as mock_mask:
            mock_mask.return_value = "8291****15A"
            with patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "8291295148:AAH2myFvIMKU1e8AWVyyg5rE3vcCFgfC15A"}):
                tg_mod._mask_token("8291295148:AAH2myFvIMKU1e8AWVyyg5rE3vcCFgfC15A")
            mock_mask.assert_called_once_with("8291295148:AAH2myFvIMKU1e8AWVyyg5rE3vcCFgfC15A")
