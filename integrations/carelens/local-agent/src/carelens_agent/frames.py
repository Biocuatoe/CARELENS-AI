"""In-memory frame handling: unpack chunks, check JPEG headers and hashes, check cadence, build requests.

Frames are held in bytearrays and wiped by `wipe()` after use. Nothing here writes to disk or logs bytes.
"""
from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass, field
from typing import Any

MAX_FRAME_BYTES = 200_000
MAX_W, MAX_H = 640, 480
NOMINAL_INTERVAL_MS = 125
GAP_INTERVAL_MS = 187  # > 1.5 frame periods: at least one frame missing


class InputRejected(ValueError):
    """The capture cannot be analysed (corrupt or inconsistent media). Not retryable."""


def unpack(body: bytes | bytearray | memoryview, expected: int) -> list[memoryview]:
    view = memoryview(body)
    frames: list[memoryview] = []
    i = 0
    while i < len(view):
        if i + 4 > len(view):
            raise InputRejected("truncated length prefix")
        (n,) = struct.unpack_from("<I", view, i)
        if not 0 < n <= MAX_FRAME_BYTES or i + 4 + n > len(view):
            raise InputRejected(f"bad frame length in chunk (frame {len(frames)})")
        frames.append(view[i + 4 : i + 4 + n])
        i += 4 + n
    if len(frames) != expected:
        raise InputRejected(f"chunk has {len(frames)} frames, expected {expected}")
    return frames


def jpeg_size(frame: bytes | memoryview) -> tuple[int, int] | None:
    """(width, height) from the first SOF header, or None for anything that is not a well-formed JPEG."""
    b = bytes(frame[:4]) if len(frame) >= 4 else b""
    if len(frame) < 4 or b[:2] != b"\xff\xd8":
        return None
    data = memoryview(frame)
    end = len(data)
    while end > 2 and data[end - 1] == 0:
        end -= 1
    if data[end - 2] != 0xFF or data[end - 1] != 0xD9:
        return None
    i = 2
    while i + 4 <= end:
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        while marker == 0xFF and i + 2 < end:
            i += 1
            marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = (data[i + 2] << 8) | data[i + 3]
        if length < 2 or i + 2 + length > end:
            return None
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if length < 7:
                return None
            h = (data[i + 5] << 8) | data[i + 6]
            w = (data[i + 7] << 8) | data[i + 8]
            return (w, h) if w and h else None
        if marker in (0xDA, 0xD9):
            return None
        i += 2 + length
    return None


def window_plan(frame_count: int) -> list[tuple[int, int]]:
    if frame_count == 24:
        return [(0, 23)]
    if frame_count == 40:
        return [(0, 23), (8, 31), (16, 39)]
    raise InputRejected(f"no window plan for {frame_count} frames")


@dataclass
class InputValidation:
    frame_count: int
    jpeg_ok: bool
    cadence_status: str
    min_interval_ms: int | None
    max_interval_ms: int | None
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "frame_count": self.frame_count,
            "jpeg_ok": self.jpeg_ok,
            "cadence_status": self.cadence_status,
            "min_interval_ms": self.min_interval_ms,
            "max_interval_ms": self.max_interval_ms,
            "issues": self.issues[:50],
        }


def check_cadence(offsets: list[int], tolerance_ms: int) -> tuple[str, int | None, int | None, list[str]]:
    intervals = [b - a for a, b in zip(offsets, offsets[1:])]
    status, issues = "ok", []
    for i, d in enumerate(intervals):
        if d <= 0:
            status = "gap"
            issues.append(f"non-increasing time between frames {i} and {i + 1}")
        elif d > GAP_INTERVAL_MS:
            status = "gap"
            issues.append(f"gap of {d} ms between frames {i} and {i + 1}")
        elif abs(d - NOMINAL_INTERVAL_MS) > tolerance_ms:
            if status == "ok":
                status = "out_of_tolerance"
            issues.append(f"interval {d} ms between frames {i} and {i + 1} outside {NOMINAL_INTERVAL_MS}±{tolerance_ms} ms")
    return status, (min(intervals) if intervals else None), (max(intervals) if intervals else None), issues[:20]


def validate(payload: dict[str, Any], frames: list[memoryview]) -> InputValidation:
    """Re-checks what the backend checked (defence in depth): count, order, hashes, JPEG headers, size,
    dimensions and cadence. Corrupt media raises InputRejected; a cadence gap is reported, not raised."""
    manifest = payload.get("frames")
    count = payload.get("frame_count")
    if not isinstance(manifest, list) or not isinstance(count, int) or len(manifest) != count or len(frames) != count:
        raise InputRejected("frame list does not match frame_count")
    if [m.get("seq") for m in manifest] != list(range(count)):
        raise InputRejected("frames are not in sequence order 0..n-1")
    width, height = payload.get("frame_width"), payload.get("frame_height")
    for i, (meta, frame) in enumerate(zip(manifest, frames)):
        if len(frame) != meta.get("size_bytes"):
            raise InputRejected(f"frame {i} size differs from the manifest")
        if hashlib.sha256(frame).hexdigest() != meta.get("sha256"):
            raise InputRejected(f"frame {i} hash differs from the manifest")
        size = jpeg_size(frame)
        if size is None:
            raise InputRejected(f"frame {i} is not a well-formed JPEG")
        if size != (width, height) or size[0] > MAX_W or size[1] > MAX_H:
            raise InputRejected(f"frame {i} dimensions {size} differ from the manifest or exceed 640x480")
    offsets = [int(m.get("t_offset_ms", -1)) for m in manifest]
    tolerance = int(payload.get("cadence_tolerance_ms", 40))
    status, lo, hi, issues = check_cadence(offsets, tolerance)
    return InputValidation(count, True, status, lo, hi, issues)


def pack(frames: list[memoryview]) -> bytearray:
    out = bytearray()
    for f in frames:
        out += struct.pack("<I", len(f))
        out += f
    return out


def wipe(*buffers: bytearray) -> None:
    """Overwrite buffers in place. Best effort: Python may hold other transient copies (e.g. socket
    buffers), which are released, not persisted."""
    for b in buffers:
        if isinstance(b, bytearray) and len(b):
            b[:] = b"\x00" * len(b)
