"""In-memory device state and reducers for demo-control."""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Literal

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

HubId = Literal["d_hub_liveshowcase"]
CoreId = Literal["d_core_liveshowcase"]
DeviceId = HubId | CoreId
Product = Literal["carelens", "ecopatch"]

DEMO_ALERT_THRESHOLD = 7

# ---------------------------------------------------------------------------
# Device state
# ---------------------------------------------------------------------------

class DeviceState:
    """Single device state machine. All state transitions are deterministic."""

    __slots__ = ("id", "recipient_id", "product", "kind", "online", "last_seen_at", "_latest_data_hr", "_latest_data_spo2", "_hr_at", "_spo2_at")

    def __init__(
        self,
        id: DeviceId,
        recipient_id: str,
        product: Product,
        kind: str,
    ) -> None:
        self.id: DeviceId = id
        self.recipient_id: str = recipient_id
        self.product: Product = product
        self.kind: str = kind
        self.online: bool = False
        self.last_seen_at: str | None = None
        # Separate storage for heart rate and SpO2 so both can coexist in SSE history.
        self._latest_data_hr: dict | None = None
        self._latest_data_spo2: dict | None = None
        self._hr_at: str | None = None
        self._spo2_at: str | None = None

    @property
    def signal(self) -> str:
        return "connected" if self.online else "offline"

    @property
    def latest_data(self) -> dict | None:  # type: ignore[return]
        """Return the most recently updated telemetry (HR preferred over SpO2)."""
        if self._latest_data_hr is not None:
            if self._latest_data_spo2 is not None:
                # Return whichever is newer
                hr_ts = self._hr_at or ""
                spo2_ts = self._spo2_at or ""
                return self._latest_data_hr if hr_ts >= spo2_ts else self._latest_data_spo2
            return self._latest_data_hr
        return self._latest_data_spo2

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _synthetic_heart_rate(self) -> dict:
        now_s = datetime.now(timezone.utc).timestamp()
        # Deterministic-ish value based on current time: oscillates between ~60-100 bpm
        raw = 60 + int(40 * (math.sin(now_s / 30) + 1) / 2)
        return {
            "kind": "heart_rate",
            "value": raw,
            "unit": "bpm",
            "quality": "fair",
            "observed_at": self._now_iso(),
            "summary": None,
        }

    def _hub_status_data(self) -> dict:
        return {
            "kind": "hub_status",
            "value": None,
            "unit": None,
            "quality": None,
            "observed_at": self._now_iso(),
            "summary": "AI ghi nhận hoạt động bình thường.",
        }

    def go_online(self) -> None:
        if self.online:
            return  # Idempotent
        self.online = True
        self.last_seen_at = self._now_iso()
        if self.product == "carelens":
            self._latest_data_hr = self._hub_status_data()
        else:
            self._latest_data_hr = self._synthetic_heart_rate()

    def go_offline(self) -> None:
        if not self.online:
            return  # Idempotent
        self.online = False
        self.last_seen_at = None
        self._latest_data_hr = None
        self._latest_data_spo2 = None
        self._hr_at = None
        self._spo2_at = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "recipient_id": self.recipient_id,
            "product": self.product,
            "kind": self.kind,
            "online": self.online,
            "last_seen_at": self.last_seen_at,
            "last_seen_ms": self._last_seen_ms(),
            "signal": self.signal,
            "latest_data": self.latest_data,
        }

    def update_telemetry(
        self,
        bpm: float | None = None,
        spo2: float | None = None,
        quality: str = "fair",
        observed_at: str | None = None,
        seq: int | None = None,
        finger_detected: bool = True,
        status: str | None = None,
    ) -> None:
        """
        Update telemetry data from Firebase RTDB (or any real device source).

        Each metric is stored separately so both HR and SpO2 can coexist in SSE history.
        The device is set online whenever at least one valid metric arrives.

        Args:
            bpm: Heart rate in BPM, or None to leave unchanged.
            spo2: SpO2 in percent (50–100), or None to leave unchanged.
            quality: Signal quality string ("good" | "fair" | "poor").
            observed_at: ISO-8601 timestamp of the measurement.
            seq: Device sequence number (for dedup on the device side).
            finger_detected: Whether the finger was detected (cosmetic info).
            status: Device status string ("ok" | "error" | ...).
        """
        del seq, finger_detected, status  # unused but kept in signature for future use
        now = self._now_iso()
        ts = observed_at or now

        if bpm is not None:
            self.online = True
            self.last_seen_at = now
            self._latest_data_hr = {
                "kind": "heart_rate",
                "value": bpm,
                "unit": "bpm",
                "quality": quality,
                "observed_at": ts,
                "summary": None,
            }
            self._hr_at = now

        if spo2 is not None:
            self.online = True
            self.last_seen_at = now
            self._latest_data_spo2 = {
                "kind": "spo2",
                "value": spo2,
                "unit": "%",
                "quality": quality,
                "observed_at": ts,
                "summary": None,
            }
            self._spo2_at = now

    def _last_seen_ms(self) -> int | None:
        if self.last_seen_at is None:
            return None
        dt = datetime.fromisoformat(self.last_seen_at)
        return int(dt.timestamp() * 1000)


# ---------------------------------------------------------------------------
# Global state singleton
# ---------------------------------------------------------------------------

_carelens: DeviceState = DeviceState(
    id="d_hub_liveshowcase",
    recipient_id="r_liveshowcase",
    product="carelens",
    kind="carelens_hub",
)

_ecopatch: DeviceState = DeviceState(
    id="d_core_liveshowcase",
    recipient_id="r_liveshowcase",
    product="ecopatch",
    kind="ecopatch_core",
)

DEVICES: dict[DeviceId, DeviceState] = {
    "d_hub_liveshowcase": _carelens,
    "d_core_liveshowcase": _ecopatch,
}

_sequence: int = 0
_HISTORY_SEQ: int = 0
_RESET_AT: str | None = None

# Session state for r_liveshowcase (populated by Telegram commands)
_EVENTS: list[dict] = []
_ALERTS: list[dict] = []
_NOTES: list[dict] = []


def next_seq() -> int:
    global _sequence
    _sequence += 1
    return _sequence


def current_seq() -> int:
    return _sequence


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _next_history_seq() -> int:
    global _HISTORY_SEQ
    _HISTORY_SEQ += 1
    return _HISTORY_SEQ


def _apply_carelens_event(
    category: str,
    severity: str,
    care_level: int,
    summary: str,
    type_: str | None = None,
    source_mode: str = "simulated",
) -> dict:
    """
    Create a CareLens care event and optionally auto-generate an alert.
    Appends to _EVENTS and _ALERTS (module-level session state for r_liveshowcase).
    """
    global _EVENTS, _ALERTS
    now_iso = _now_iso()
    source_record_id = f"telegram-{_next_history_seq()}"
    event_id = _gen_id("evt")

    event: dict = {
        "id": event_id,
        "device_id": "d_hub_liveshowcase",
        "recipient_id": "r_liveshowcase",
        "category": category,
        "severity": severity,
        "care_level": care_level,
        "summary": summary,
        "description": "",
        "observed_at": now_iso,
        "received_at": now_iso,
        "source_mode": source_mode,
        "schema_version": "demo-control-1",
        "source_record_id": source_record_id,
        "alert_triggered": care_level >= DEMO_ALERT_THRESHOLD,
        "product": "carelens",
    }
    # type field defaults to category for back-compat; can be overridden (e.g. "lying")
    event["type"] = type_ or category
    _EVENTS.append(event)

    if care_level >= DEMO_ALERT_THRESHOLD:
        alert = {
            "id": _gen_id("al"),
            "device_id": "d_hub_liveshowcase",
            "recipient_id": "r_liveshowcase",
            "severity": severity,
            "category": category,
            "summary": summary,
            "status": "open",
            "triggered_at": now_iso,
            "acknowledged_at": None,
            "acknowledged_by": None,
            "review_outcome": None,
            "review_note": None,
            "resolved_at": None,
            "resolved_by": None,
            "product": "carelens",
        }
        _ALERTS.append(alert)

    next_seq()
    return full_state()


def add_care_activity_event(summary: str, type_: str, source: str = "telegram") -> dict:
    """
    Add a CareLens care-activity event (water/medicine) to r_liveshowcase.

    Both a Timeline event AND a History note are created from the same command
    so the action appears in the existing event/timeline/history UI. The note
    carries the same body so /c_water and /c_medicine show up in the History
    list. No alert is created.
    """
    # Create the timeline event first so it carries the proper id/summary.
    _apply_carelens_event(
        category="care_activity",
        severity="info",
        care_level=0,
        summary=summary,
        type_=type_,
        source_mode=source,
    )
    # Also append a note so History UI shows the same record.
    # Skip note if a note with the same body already exists (defensive against
    # accidental double-fire from the SSE pipeline).
    if not any(n.get("body") == summary for n in _NOTES):
        _NOTES.append({
            "id": _gen_id("note"),
            "recipient_id": "r_liveshowcase",
            "author_name": "Demo Bot (Telegram)" if source == "telegram" else "Demo Bot",
            "body": summary,
            "created_at": _now_iso(),
            "source": source,
        })
    return full_state()


def add_note(body: str, author: str = "Demo Bot (Telegram)", source: str = "telegram") -> dict:
    """
    Add a care note to the session state for r_liveshowcase.
    Used by /c_water and /c_medicine commands.
    """
    global _NOTES
    now_iso = _now_iso()
    note = {
        "id": _gen_id("note"),
        "recipient_id": "r_liveshowcase",
        "author_name": author,
        "body": body,
        "created_at": now_iso,
        "source": source,
    }
    _NOTES.append(note)
    next_seq()
    return full_state()


def reset_liveshowcase() -> dict:
    """
    Reset the liveshowcase session state:
    - Set both devices offline
    - Clear events, alerts, and notes for r_liveshowcase
    - Increment sequence so SSE clients see a NEWER seq (do NOT reset to 0)
    Does NOT affect other personas' fixture state (r_an, r_binh, etc.)
    Does NOT affect the SSE broadcaster, Telegram polling, or FastAPI loop.
    """
    global _EVENTS, _ALERTS, _NOTES, _HISTORY_SEQ, _RESET_AT
    _carelens.go_offline()
    _ecopatch.go_offline()
    _EVENTS = []
    _ALERTS = []
    _NOTES = []
    _HISTORY_SEQ = 0
    _RESET_AT = _now_iso()
    next_seq()
    return full_state()


# ---------------------------------------------------------------------------
# Test isolation helper
# ---------------------------------------------------------------------------

def reset_state() -> None:
    """Reset all device and sequence state to initial values. For testing only."""
    global _sequence, _EVENTS, _ALERTS, _NOTES, _HISTORY_SEQ, _RESET_AT
    _sequence = 0
    _HISTORY_SEQ = 0
    _RESET_AT = None
    _EVENTS = []
    _ALERTS = []
    _NOTES = []
    for device in DEVICES.values():
        device.online = False
        device.last_seen_at = None
        device._latest_data_hr = None
        device._latest_data_spo2 = None
        device._hr_at = None
        device._spo2_at = None


def apply_command(cmd: str, source: str = "simulated") -> dict:
    """
    Apply a command and return the updated device states.

    Valid commands:
      carelens_online, carelens_offline
      ecopatch_online, ecopatch_offline
      carelens_event_posture, carelens_event_fall, carelens_event_idle,
      carelens_event_lying, carelens_event_activity
      carelens_water, carelens_medicine
      reset

    Args:
        cmd: The command string.
        source: The source of the command. If "telegram", events are tagged
            with source_mode="telegram" and notes include source="telegram".
    """
    global _EVENTS, _ALERTS

    # Online/offline commands
    mapping: dict[str, tuple[DeviceState, Literal["online", "offline"]]] = {
        "carelens_online": (_carelens, "online"),
        "carelens_offline": (_carelens, "offline"),
        "ecopatch_online": (_ecopatch, "online"),
        "ecopatch_offline": (_ecopatch, "offline"),
    }
    if cmd in mapping:
        device, action = mapping[cmd]
        if action == "online":
            device.go_online()
        else:
            device.go_offline()
        next_seq()  # increment so SSE clients see a newer seq
        return full_state()

    # CareLens event commands: (category, severity, care_level, summary, type_, description)
    event_commands: dict[str, tuple[str, str, int, str, str | None, str]] = {
        "carelens_event_posture": (
            "posture", "warning", 7,
            "AI ghi nhận tư thế bất thường.",
            None,  # type_ → defaults to "posture"
            "Tư thế người dùng khác biệt so với trạng thái thường ngày.",
        ),
        "carelens_event_fall": (
            "fall_like", "critical", 9,
            "AI ghi nhận dấu hiệu ngã.",
            None,
            "Phát hiện chuyển động đột ngột kèm thay đổi độ cao.",
        ),
        "carelens_event_idle": (
            "inactivity", "notice", 4,
            "AI ghi nhận người dùng ngồi yên trong thời gian dài.",
            None,
            "Không có hoạt động trong 45 phút.",
        ),
        "carelens_event_activity": (
            "activity", "info", 2,
            "AI ghi nhận người dùng đang di chuyển trong phòng.",
            None,
            "Phát hiện chuyển động thường ngày.",
        ),
        "carelens_event_lying": (
            "posture", "notice", 3,
            "AI ghi nhận người dùng đang ở tư thế nằm.",
            "lying",  # type_ = "lying" (category stays "posture" per user decision)
            "Người dùng nằm trên giường hoặc sàn.",
        ),
    }
    if cmd in event_commands:
        category, severity, care_level, summary, type_, _description = event_commands[cmd]
        return _apply_carelens_event(
            category, severity, care_level, summary,
            type_=type_, source_mode=source,
        )

    # Water / medicine commands → add CareLens care-activity event (visible in Timeline)
    if cmd == "carelens_water":
        return add_care_activity_event(
            summary="Đã ghi nhận người dùng uống nước.",
            type_="water",
            source=source,
        )

    if cmd == "carelens_medicine":
        return add_care_activity_event(
            summary="Đã ghi nhận người dùng uống thuốc.",
            type_="medicine",
            source=source,
        )

    if cmd == "reset":
        return reset_liveshowcase()

    raise ValueError(f"Unknown command: {cmd}")


def full_state() -> dict:
    now = datetime.now(timezone.utc)
    return {
        "schema_version": "demo-control-1",
        "seq": current_seq(),
        "updated_at": now.isoformat(),
        "hubs": {k: v.to_dict() for k, v in DEVICES.items()},
        "events": list(_EVENTS),
        "alerts": list(_ALERTS),
        "notes": list(_NOTES),
        "reset_at": _RESET_AT,
    }


def update_device_telemetry(
    device_id: DeviceId,
    bpm: float | None = None,
    spo2: float | None = None,
    quality: str = "fair",
    observed_at: str | None = None,
    seq: int | None = None,
    finger_detected: bool = True,
    status: str | None = None,
) -> None:
    """
    Update real telemetry for a device from an external source (e.g. Firebase RTDB).

    This function is the entry point for the Firebase bridge.
    It ONLY targets `d_core_liveshowcase` (r_liveshowcase) — static persona
    devices are unaffected by Firebase data.

    Args:
        device_id: Must be "d_core_liveshowcase". Other IDs are silently ignored.
        bpm: Heart rate in BPM.
        spo2: SpO2 in percent.
        quality: Signal quality string.
        observed_at: ISO-8601 timestamp of the measurement.
        seq: Device sequence number (passed but not currently used for dedup here).
        finger_detected: Whether finger was detected.
        status: Device status string.
    """
    device = DEVICES.get(device_id)
    if device is None:
        return  # Unknown device — silently ignore
    if device_id != "d_core_liveshowcase":
        return  # Only allow telemetry for d_core_liveshowcase
    device.update_telemetry(
        bpm=bpm,
        spo2=spo2,
        quality=quality,
        observed_at=observed_at,
        seq=seq,
        finger_detected=finger_detected,
        status=status,
    )
    next_seq()

