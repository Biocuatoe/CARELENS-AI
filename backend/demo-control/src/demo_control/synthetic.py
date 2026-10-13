"""Synthetic data generation for EcoPatch heart rate in demo-control."""
from __future__ import annotations

import math
from datetime import datetime, timezone


def synthetic_heart_rate() -> dict:
    """
    Deterministic-ish heart rate based on current time.
    Oscillates smoothly between ~60 and ~100 bpm.
    """
    now_s = datetime.now(timezone.utc).timestamp()
    raw = 60 + int(40 * (math.sin(now_s / 30) + 1) / 2)
    return {
        "kind": "heart_rate",
        "value": raw,
        "unit": "bpm",
        "quality": "fair",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "summary": None,
    }
