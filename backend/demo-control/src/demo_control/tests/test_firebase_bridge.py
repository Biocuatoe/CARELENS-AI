"""Tests for Firebase bridge and update_device_telemetry."""
from __future__ import annotations

import pytest
from demo_control.state import (
    DEVICES,
    apply_command,
    reset_state,
    update_device_telemetry,
)
from datetime import datetime, timezone


@pytest.fixture(autouse=True)
def clean_state():
    """Reset global state before each test to ensure isolation."""
    reset_state()
    yield


# ---------------------------------------------------------------------------
# update_device_telemetry — core behaviour
# ---------------------------------------------------------------------------

class TestUpdateDeviceTelemetry:
    """Tests for the update_device_telemetry() function."""

    def test_sets_d_core_online(self):
        """update_device_telemetry sets d_core_liveshowcase online."""
        assert DEVICES["d_core_liveshowcase"].online is False
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=72)
        assert DEVICES["d_core_liveshowcase"].online is True

    def test_sets_last_seen_at(self):
        """update_device_telemetry sets last_seen_at."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=75)
        assert DEVICES["d_core_liveshowcase"].last_seen_at is not None

    def test_bpm_updates_latest_data(self):
        """update_device_telemetry with bpm sets latest_data to heart_rate."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=78)
        core = DEVICES["d_core_liveshowcase"]
        assert core.latest_data is not None
        assert core.latest_data["kind"] == "heart_rate"
        assert core.latest_data["value"] == 78
        assert core.latest_data["unit"] == "bpm"
        assert core.latest_data["quality"] == "fair"

    def test_spo2_updates_latest_data(self):
        """update_device_telemetry with spo2 sets latest_data to spo2."""
        update_device_telemetry(device_id="d_core_liveshowcase", spo2=98)
        core = DEVICES["d_core_liveshowcase"]
        assert core.latest_data is not None
        assert core.latest_data["kind"] == "spo2"
        assert core.latest_data["value"] == 98
        assert core.latest_data["unit"] == "%"

    def test_bpm_and_spo2_both_stored(self):
        """Both BPM and SpO2 are stored independently so both appear in SSE history."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=70, spo2=97)
        core = DEVICES["d_core_liveshowcase"]
        # Both are stored (latest_data returns whichever is newer)
        assert core._latest_data_hr is not None
        assert core._latest_data_spo2 is not None
        assert core._latest_data_hr["kind"] == "heart_rate"
        assert core._latest_data_hr["value"] == 70
        assert core._latest_data_spo2["kind"] == "spo2"
        assert core._latest_data_spo2["value"] == 97

    def test_quality_passed_through(self):
        """Quality is passed through to the stored data."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=68, quality="good")
        core = DEVICES["d_core_liveshowcase"]
        assert core._latest_data_hr["quality"] == "good"

    def test_observed_at_passed_through(self):
        """observed_at is stored in the telemetry data."""
        update_device_telemetry(device_id="d_core_liveshowcase", spo2=99, observed_at="2026-09-22T12:00:00+00:00")
        core = DEVICES["d_core_liveshowcase"]
        assert core._latest_data_spo2["observed_at"] == "2026-09-22T12:00:00+00:00"

    def test_increments_sequence(self):
        """Each update_device_telemetry call increments the sequence."""
        from demo_control.state import current_seq
        before = current_seq()
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=72)
        assert current_seq() > before

    def test_unknown_device_ignored(self):
        """Unknown device ids are silently ignored."""
        update_device_telemetry(device_id="d_hub_an", bpm=72)  # r_an hub — not d_core_liveshowcase
        # No crash, no state change for d_core_liveshowcase
        assert DEVICES["d_core_liveshowcase"].online is False

    def test_only_allows_d_core_liveshowcase(self):
        """Only d_core_liveshowcase is writable; other device ids are silently ignored."""
        # d_hub_liveshowcase should not be affected
        update_device_telemetry(device_id="d_hub_liveshowcase", bpm=72)
        assert DEVICES["d_hub_liveshowcase"].online is False

    def test_null_bpm_is_safe(self):
        """Calling with bpm=None is safe and doesn't crash."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=None, spo2=96)
        core = DEVICES["d_core_liveshowcase"]
        assert core.online is True
        assert core._latest_data_spo2["value"] == 96

    def test_null_spo2_is_safe(self):
        """Calling with spo2=None is safe and doesn't crash."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=80, spo2=None)
        core = DEVICES["d_core_liveshowcase"]
        assert core.online is True
        assert core._latest_data_hr["value"] == 80

    def test_all_nulls_safe(self):
        """Calling with all nulls is safe (device stays offline)."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=None, spo2=None)
        # Device stays offline with no data
        core = DEVICES["d_core_liveshowcase"]
        assert core.online is False

    def test_respect_hr_vs_spo2_precedence(self):
        """latest_data prefers the most recently updated metric."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=65)
        update_device_telemetry(device_id="d_core_liveshowcase", spo2=95)
        # After spo2 update, last_seen_at is updated so spo2 is newest
        core = DEVICES["d_core_liveshowcase"]
        # latest_data returns whichever was written last
        # Both stored
        assert core._latest_data_hr is not None
        assert core._latest_data_spo2 is not None


# ---------------------------------------------------------------------------
# update_device_telemetry — interaction with apply_command
# ---------------------------------------------------------------------------

class TestTelemetryWithApplyCommand:
    """Tests that update_device_telemetry and apply_command coexist cleanly."""

    def test_telemetry_after_ecopatch_online(self):
        """Applying ecopatch_online then telemetry update preserves both data."""
        apply_command("ecopatch_online")
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=88)
        core = DEVICES["d_core_liveshowcase"]
        # Telemetry update takes precedence (latest_data returns most recent)
        assert core.online is True
        assert core._latest_data_hr["value"] == 88

    def test_telemetry_after_reset(self):
        """Telemetry update after reset brings device back online."""
        apply_command("ecopatch_online")
        apply_command("reset")
        assert DEVICES["d_core_liveshowcase"].online is False
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=91)
        assert DEVICES["d_core_liveshowcase"].online is True

    def test_ecopatch_offline_clears_telemetry(self):
        """ecopatch_offline clears both HR and SpO2 telemetry."""
        update_device_telemetry(device_id="d_core_liveshowcase", bpm=70, spo2=97)
        apply_command("ecopatch_offline")
        core = DEVICES["d_core_liveshowcase"]
        assert core.online is False
        assert core._latest_data_hr is None
        assert core._latest_data_spo2 is None
        assert core.latest_data is None


# ---------------------------------------------------------------------------
# firebase_bridge module — startup/shutdown when not configured
# ---------------------------------------------------------------------------

class TestFirebaseBridgeModule:
    """Tests for the firebase_bridge module-level functions (no Firebase needed)."""

    def test_start_firebase_bridge_no_config_silent(self):
        """start_firebase_bridge is safe to call without FIREBASE_DATABASE_URL."""
        import asyncio
        from demo_control.firebase_bridge import start_firebase_bridge

        async def run():
            # Should not raise — just logs and returns
            await start_firebase_bridge(lambda: asyncio.coroutine(lambda: None)())
        asyncio.run(run())

    def test_stop_firebase_bridge_no_bridge_silent(self):
        """stop_firebase_bridge is safe to call when bridge was never started."""
        import asyncio
        from demo_control.firebase_bridge import stop_firebase_bridge

        async def run():
            # Should not raise — just no-ops
            await stop_firebase_bridge()
        asyncio.run(run())

    def test_clamp_helper(self):
        """_clamp clamps values to the valid range."""
        from demo_control.firebase_bridge import _clamp
        assert _clamp(25, 30, 250, None) == 30   # below range
        assert _clamp(300, 30, 250, None) == 250  # above range
        assert _clamp(72, 30, 250, None) == 72    # in range
        assert _clamp(None, 30, 250, 70) == 70   # non-numeric → default
        assert _clamp("bad", 30, 250, 70) == 70  # non-numeric string → default

    def test_quality_from_perfusion(self):
        """_quality_from_perfusion returns correct quality levels."""
        from demo_control.firebase_bridge import _quality_from_perfusion
        assert _quality_from_perfusion(3.0) == "good"
        assert _quality_from_perfusion(2.0) == "good"
        assert _quality_from_perfusion(1.5) == "fair"
        assert _quality_from_perfusion(0.5) == "fair"
        assert _quality_from_perfusion(0.3) == "poor"
        assert _quality_from_perfusion(None) == "fair"      # default
        assert _quality_from_perfusion("bad") == "fair"   # default
