"""Tests for demo_control.commands."""
from __future__ import annotations

import pytest
from demo_control.commands import parse_telegram_command


class TestParseTelegramCommand:
    def test_carelens_online(self):
        payload = {
            "message": {
                "text": "/carelens_online",
                "chat": {"id": 123456},
            }
        }
        assert parse_telegram_command(payload) == "carelens_online"

    def test_carelens_offline(self):
        payload = {"message": {"text": "/carelens_offline", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) == "carelens_offline"

    def test_ecopatch_online(self):
        payload = {"message": {"text": "/ecopatch_online", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) == "ecopatch_online"

    def test_ecopatch_offline(self):
        payload = {"message": {"text": "/ecopatch_offline", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) == "ecopatch_offline"

    def test_edited_message(self):
        payload = {"edited_message": {"text": "/carelens_online", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) == "carelens_online"

    def test_unknown_command_returns_none(self):
        payload = {"message": {"text": "/start", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) is None

    def test_empty_payload_returns_none(self):
        assert parse_telegram_command({}) is None

    def test_non_command_message_returns_none(self):
        payload = {"message": {"text": "Hello world", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) is None

    def test_whitespace_command(self):
        payload = {"message": {"text": "  /carelens_online  ", "chat": {"id": 123456}}}
        assert parse_telegram_command(payload) == "carelens_online"
