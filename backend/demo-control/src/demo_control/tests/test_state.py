"""Tests for demo_control.state."""
from __future__ import annotations

import pytest
from demo_control.state import (
    DEVICES,
    _ALERTS,
    _EVENTS,
    _NOTES,
    apply_command,
    current_seq,
    full_state,
    next_seq,
    reset_liveshowcase,
    reset_state,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_state():
    """Reset global state before each test to ensure isolation."""
    reset_state()
    yield


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _hub():
    return DEVICES["d_hub_liveshowcase"]


def _core():
    return DEVICES["d_core_liveshowcase"]


# ---------------------------------------------------------------------------
# Initial state
# ---------------------------------------------------------------------------

class TestInitialState:
    def test_carelens_offline(self):
        hub = _hub()
        assert hub.online is False
        assert hub.signal == "offline"
        assert hub.last_seen_at is None
        assert hub.latest_data is None

    def test_ecopatch_offline(self):
        core = _core()
        assert core.online is False
        assert core.signal == "offline"
        assert core.last_seen_at is None
        assert core.latest_data is None

    def test_devices_independent_initial(self):
        """Both devices start offline and do not affect each other."""
        hub = _hub()
        core = _core()
        assert hub.online is False
        assert core.online is False


# ---------------------------------------------------------------------------
# carelens_online
# ---------------------------------------------------------------------------

class TestCareLensOnline:
    def test_carelens_online(self):
        apply_command("carelens_online")
        hub = _hub()
        assert hub.online is True
        assert hub.signal == "connected"
        assert hub.last_seen_at is not None
        assert hub.latest_data is not None
        assert hub.latest_data["kind"] == "hub_status"
        assert hub.latest_data["summary"] == "AI ghi nhận hoạt động bình thường."
        assert hub.latest_data["observed_at"] is not None

    def test_ecopatch_unchanged_after_carelens_online(self):
        apply_command("carelens_online")
        core = _core()
        assert core.online is False
        assert core.signal == "offline"
        assert core.latest_data is None

    def test_carelens_online_idempotent(self):
        """Second online command is a no-op (no error, state unchanged)."""
        apply_command("carelens_online")
        state_after_first = full_state()
        apply_command("carelens_online")
        state_after_second = full_state()
        assert state_after_first["hubs"]["d_hub_liveshowcase"]["online"] is True
        assert state_after_second["hubs"]["d_hub_liveshowcase"]["online"] is True


# ---------------------------------------------------------------------------
# ecopatch_online
# ---------------------------------------------------------------------------

class TestEcoPatchOnline:
    def test_ecopatch_online(self):
        apply_command("ecopatch_online")
        core = _core()
        assert core.online is True
        assert core.signal == "connected"
        assert core.last_seen_at is not None
        assert core.latest_data is not None
        assert core.latest_data["kind"] == "heart_rate"
        assert core.latest_data["value"] is not None
        assert core.latest_data["unit"] == "bpm"
        assert core.latest_data["quality"] == "fair"
        assert core.latest_data["observed_at"] is not None

    def test_carelens_unchanged_after_ecopatch_online(self):
        apply_command("ecopatch_online")
        hub = _hub()
        assert hub.online is False
        assert hub.signal == "offline"
        assert hub.latest_data is None


# ---------------------------------------------------------------------------
# carelens_offline
# ---------------------------------------------------------------------------

class TestCareLensOffline:
    def test_carelens_offline_after_online(self):
        apply_command("carelens_online")
        apply_command("carelens_offline")
        hub = _hub()
        assert hub.online is False
        assert hub.signal == "offline"
        assert hub.last_seen_at is None
        assert hub.latest_data is None

    def test_ecopatch_unchanged_after_carelens_offline(self):
        apply_command("ecopatch_online")
        apply_command("carelens_offline")
        core = _core()
        assert core.online is True
        assert core.latest_data is not None

    def test_carelens_offline_idempotent(self):
        """Second offline command is a no-op."""
        apply_command("carelens_offline")
        state_after_first = full_state()
        apply_command("carelens_offline")
        state_after_second = full_state()
        assert state_after_first["hubs"]["d_hub_liveshowcase"]["online"] is False
        assert state_after_second["hubs"]["d_hub_liveshowcase"]["online"] is False


# ---------------------------------------------------------------------------
# ecopatch_offline
# ---------------------------------------------------------------------------

class TestEcoPatchOffline:
    def test_ecopatch_offline_after_online(self):
        apply_command("ecopatch_online")
        apply_command("ecopatch_offline")
        core = _core()
        assert core.online is False
        assert core.signal == "offline"
        assert core.last_seen_at is None
        assert core.latest_data is None

    def test_carelens_unchanged_after_ecopatch_offline(self):
        apply_command("carelens_online")
        apply_command("ecopatch_offline")
        hub = _hub()
        assert hub.online is True
        assert hub.latest_data is not None


# ---------------------------------------------------------------------------
# Re-application
# ---------------------------------------------------------------------------

class TestReapplyOnline:
    def test_carelens_online_after_offline(self):
        apply_command("carelens_online")
        apply_command("carelens_offline")
        apply_command("carelens_online")
        hub = _hub()
        assert hub.online is True
        assert hub.signal == "connected"
        assert hub.latest_data is not None
        assert hub.latest_data["kind"] == "hub_status"


# ---------------------------------------------------------------------------
# Independence
# ---------------------------------------------------------------------------

class TestIndependence:
    def test_carelens_flip_does_not_mutate_ecopatch(self):
        """Toggling CareLens online/offline never changes EcoPatch state."""
        for _ in range(3):
            apply_command("carelens_online")
            core_state_1 = _core().online
            apply_command("carelens_offline")
            core_state_2 = _core().online
            assert core_state_1 == core_state_2

    def test_ecopatch_flip_does_not_mutate_carelens(self):
        """Toggling EcoPatch online/offline never changes CareLens state."""
        for _ in range(3):
            apply_command("ecopatch_online")
            hub_state_1 = _hub().online
            apply_command("ecopatch_offline")
            hub_state_2 = _hub().online
            assert hub_state_1 == hub_state_2

    def test_both_online_independent(self):
        apply_command("carelens_online")
        apply_command("ecopatch_online")
        hub = _hub()
        core = _core()
        assert hub.online is True and core.online is True
        apply_command("carelens_offline")
        assert hub.online is False and core.online is True
        apply_command("ecopatch_offline")
        assert hub.online is False and core.online is False


# ---------------------------------------------------------------------------
# Sequence
# ---------------------------------------------------------------------------

class TestSequence:
    def test_apply_command_increments_seq(self):
        initial = current_seq()
        apply_command("carelens_online")
        assert current_seq() > initial

    def test_seq_increments_on_each_command(self):
        seqs = []
        for cmd in ["carelens_online", "ecopatch_online", "carelens_offline", "ecopatch_offline"]:
            apply_command(cmd)
            seqs.append(current_seq())
        assert seqs == sorted(seqs)
        assert len(set(seqs)) == len(seqs)  # All unique


# ---------------------------------------------------------------------------
# CareLens events
# ---------------------------------------------------------------------------

class TestCareLensEvents:
    def test_event_posture_creates_event_and_alert(self):
        """carelens_event_posture (careLevel=7 ≥ threshold) creates one event and one alert."""
        state = apply_command("carelens_event_posture")
        assert len(state["events"]) == 1
        evt = state["events"][0]
        assert evt["category"] == "posture"
        assert evt["severity"] == "warning"
        assert evt["care_level"] == 7
        assert evt["alert_triggered"] is True
        assert evt["recipient_id"] == "r_liveshowcase"
        assert evt["device_id"] == "d_hub_liveshowcase"

        assert len(state["alerts"]) == 1
        al = state["alerts"][0]
        assert al["severity"] == "warning"
        assert al["status"] == "open"
        assert al["recipient_id"] == "r_liveshowcase"

    def test_event_fall_creates_event_and_alert_critical(self):
        """carelens_event_fall (careLevel=9) creates one event and one critical alert."""
        state = apply_command("carelens_event_fall")
        assert len(state["events"]) == 1
        evt = state["events"][0]
        assert evt["category"] == "fall_like"
        assert evt["severity"] == "critical"
        assert evt["care_level"] == 9
        assert evt["alert_triggered"] is True

        assert len(state["alerts"]) == 1
        al = state["alerts"][0]
        assert al["severity"] == "critical"

    def test_event_idle_creates_event_no_alert(self):
        """carelens_event_idle (careLevel=4 < threshold) creates event but no alert."""
        state = apply_command("carelens_event_idle")
        assert len(state["events"]) == 1
        evt = state["events"][0]
        assert evt["category"] == "inactivity"
        assert evt["severity"] == "notice"
        assert evt["care_level"] == 4
        assert evt["alert_triggered"] is False
        assert len(state["alerts"]) == 0

    def test_event_activity_creates_event_no_alert(self):
        """carelens_event_activity (careLevel=2 < threshold) creates event but no alert."""
        state = apply_command("carelens_event_activity")
        assert len(state["events"]) == 1
        evt = state["events"][0]
        assert evt["category"] == "activity"
        assert evt["severity"] == "info"
        assert evt["care_level"] == 2
        assert evt["alert_triggered"] is False
        assert len(state["alerts"]) == 0

    def test_event_lying_creates_event_no_alert(self):
        """carelens_event_lying creates event with category=posture, type=lying, severity=notice, care_level=3, NO alert."""
        state = apply_command("carelens_event_lying")
        assert len(state["events"]) == 1
        evt = state["events"][0]
        assert evt["category"] == "posture"         # category stays posture per user decision
        assert evt["type"] == "lying"               # type field is "lying"
        assert evt["severity"] == "notice"
        assert evt["care_level"] == 3
        assert evt["alert_triggered"] is False
        assert len(state["alerts"]) == 0

    def test_event_lying_source_mode_telegram(self):
        """carelens_event_lying via source=telegram has source_mode=telegram."""
        state = apply_command("carelens_event_lying", source="telegram")
        evt = state["events"][0]
        assert evt["source_mode"] == "telegram"

    def test_telegram_events_have_source_mode_telegram(self):
        """All events emitted via apply_command(source=telegram) have source_mode=telegram."""
        state = apply_command("carelens_event_fall", source="telegram")
        assert state["events"][0]["source_mode"] == "telegram"

        state = apply_command("carelens_event_posture", source="telegram")
        assert state["events"][0]["source_mode"] == "telegram"

        state = apply_command("carelens_event_idle", source="telegram")
        assert state["events"][0]["source_mode"] == "telegram"

        state = apply_command("carelens_event_activity", source="telegram")
        assert state["events"][0]["source_mode"] == "telegram"

    def test_simulated_events_have_source_mode_simulated(self):
        """Events via apply_command without source=default have source_mode=simulated."""
        state = apply_command("carelens_event_fall")
        assert state["events"][0]["source_mode"] == "simulated"

    def test_event_type_field_always_present(self):
        """Every event dict has a type field that defaults to category."""
        for cmd in [
            "carelens_event_posture",
            "carelens_event_fall",
            "carelens_event_idle",
            "carelens_event_activity",
            "carelens_event_lying",
        ]:
            state = apply_command(cmd)
            # Use last event in the returned list (not the stale `evt` from a prior iteration)
            evt = state["events"][-1]
            assert "type" in evt, f"event from {cmd} missing 'type' field"
            # type should equal category (or "lying" for the lying command)
            if cmd == "carelens_event_lying":
                assert evt["type"] == "lying"
            else:
                assert evt["type"] == evt["category"]


# ---------------------------------------------------------------------------
# Care notes
# ---------------------------------------------------------------------------

class TestCareNotes:
    def test_water_command_adds_note(self):
        """carelens_water adds a note with expected body prefix."""
        state = apply_command("carelens_water", source="telegram")
        assert len(state["notes"]) == 1
        note = state["notes"][0]
        assert note["recipient_id"] == "r_liveshowcase"
        assert "uống nước" in note["body"]
        assert note["author_name"] == "Demo Bot (Telegram)"
        assert note["source"] == "telegram"

    def test_medicine_command_adds_note(self):
        """carelens_medicine adds a note with expected body prefix."""
        state = apply_command("carelens_medicine", source="telegram")
        assert len(state["notes"]) == 1
        note = state["notes"][0]
        assert "uống thuốc" in note["body"]
        assert note["author_name"] == "Demo Bot (Telegram)"
        assert note["source"] == "telegram"

    def test_multiple_notes_accumulate(self):
        """Water and medicine commands each add a distinct note."""
        apply_command("carelens_water")
        state = apply_command("carelens_medicine")
        assert len(state["notes"]) == 2
        bodies = [n["body"] for n in state["notes"]]
        assert any("uống nước" in b for b in bodies)
        assert any("uống thuốc" in b for b in bodies)


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

class TestReset:
    def test_reset_clears_events_alerts_notes(self):
        """reset clears events, alerts, and notes for r_liveshowcase."""
        apply_command("carelens_event_posture")  # adds 1 event + 1 alert
        apply_command("carelens_water")          # adds 1 note
        apply_command("carelens_event_lying")     # adds 1 event with type="lying"
        state = apply_command("reset")
        assert len(state["events"]) == 0
        assert len(state["alerts"]) == 0
        assert len(state["notes"]) == 0

    def test_reset_sets_both_devices_offline(self):
        """reset sets both CareLens and EcoPatch offline."""
        apply_command("carelens_online")
        apply_command("ecopatch_online")
        state = apply_command("reset")
        assert state["hubs"]["d_hub_liveshowcase"]["online"] is False
        assert state["hubs"]["d_core_liveshowcase"]["online"] is False

    def test_reset_does_not_affect_other_personas(self):
        """
        reset_liveshowcase only affects r_liveshowcase.
        Events are stored in module-level state (not per-persona), so a clean
        state after the test fixture reset ensures other personas are unaffected.
        """
        # Apply commands to populate the session
        apply_command("carelens_event_posture")
        apply_command("carelens_water")
        # The module-level state holds only r_liveshowcase data.
        # After reset_state() in the fixture teardown, module state is clean.
        # The key guarantee is that DEVICES for other personas (r_an, r_binh)
        # are not in the backend state at all — they are frontend-only fixtures.
        state = apply_command("reset")
        # After reset, the backend state is empty of events/alerts/notes
        assert len(state["events"]) == 0
        assert len(state["alerts"]) == 0
        assert len(state["notes"]) == 0

    def test_reset_resets_sequence(self):
        """reset increments sequence and sets reset_at to an ISO timestamp."""
        apply_command("carelens_online")
        apply_command("ecopatch_online")
        before = current_seq()
        assert before > 0
        state = apply_command("reset")
        # reset_liveshowcase() clears HISTORY_SEQ (the per-session history counter
        # used by source_record_id) and calls next_seq() — so the global demo
        # sequence must be strictly greater than `before`, and reset_at must be set.
        assert current_seq() > before
        assert state["seq"] > before
        assert state["reset_at"] is not None
        # Also verify full_state() after reset has reset_at set
        fs = full_state()
        assert fs["reset_at"] is not None
