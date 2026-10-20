"""Generate the startup greeting asset "Xin chào." with a local Piper voice (no network at synthesis time).

Voice: Piper `vi_VN-vais1000-medium` (single speaker; dataset VAIS-1000, licence CC BY 4.0, see README.md
§Greeting). Output: RIFF/WAVE PCM, mono, 16-bit little-endian, 16 000 Hz (the device and backend audio profile,
docs/DEVICE_API.md §8.3), leading/trailing silence trimmed, 15 ms fades, peak normalised to PEAK_DBFS.

Usage (PowerShell, venv with piper-tts + numpy):
  D:\\AI\\Envs\\CareLens-TTS\\Scripts\\python.exe tools\\make_greeting.py --model D:\\AI\\Models\\Piper\\vi_VN-vais1000-medium.onnx
Prints the asset's format, duration, SHA-256 and a pitch estimate (a proxy only; a person must listen to it).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import struct
import sys
import wave
from pathlib import Path

import numpy as np

TEXT = "Xin chào."
OUT_RATE = 16_000
PEAK_DBFS = -3.0
FADE_MS = 15
SILENCE_DBFS = -45.0
PAD_MS = 60


def synthesize(model: Path, length_scale: float, text: str = TEXT) -> tuple[np.ndarray, int]:
    from piper import PiperVoice, SynthesisConfig  # imported here so --help works without piper

    voice = PiperVoice.load(str(model))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text, wf, syn_config=SynthesisConfig(length_scale=length_scale))
    buf.seek(0)
    with wave.open(buf, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise SystemExit(f"unexpected Piper output: {wf.getnchannels()} ch, {wf.getsampwidth() * 8} bit")
        rate = wf.getframerate()
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    return pcm, rate


def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    """Band-limited resampling in the frequency domain (the clip is short and padded with silence)."""
    if src == dst:
        return x
    n_out = int(round(len(x) * dst / src))
    spec = np.fft.rfft(x)
    keep = n_out // 2 + 1
    out_spec = np.zeros(keep, dtype=complex)
    m = min(keep, len(spec))
    out_spec[:m] = spec[:m]
    return np.fft.irfft(out_spec, n_out) * (n_out / len(x))


def trim(x: np.ndarray, rate: int) -> np.ndarray:
    frame = rate // 100
    level = 10 ** (SILENCE_DBFS / 20)
    rms = np.array([np.sqrt(np.mean(x[i : i + frame] ** 2)) for i in range(0, len(x) - frame, frame)])
    voiced = np.nonzero(rms > level)[0]
    if len(voiced) == 0:
        raise SystemExit("synthesis produced only silence")
    pad = rate * PAD_MS // 1000
    return x[max(0, voiced[0] * frame - pad) : min(len(x), (voiced[-1] + 1) * frame + pad)]


def finish(x: np.ndarray, rate: int) -> bytes:
    fade = rate * FADE_MS // 1000
    ramp = np.linspace(0.0, 1.0, fade)
    x = x.copy()
    x[:fade] *= ramp
    x[-fade:] *= ramp[::-1]
    x *= (10 ** (PEAK_DBFS / 20)) / max(1e-9, np.max(np.abs(x)))
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2").tobytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def median_f0(x: np.ndarray, rate: int) -> float | None:
    """Median pitch of voiced 40 ms frames by autocorrelation, 70-400 Hz. A rough proxy, not a voice classifier."""
    frame, hop = int(0.04 * rate), int(0.01 * rate)
    lo, hi = rate // 400, rate // 70
    f0s = []
    for i in range(0, len(x) - frame, hop):
        seg = x[i : i + frame] - np.mean(x[i : i + frame])
        if np.sqrt(np.mean(seg**2)) < 0.02:
            continue
        ac = np.correlate(seg, seg, "full")[frame - 1 :]
        if ac[0] <= 0:
            continue
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] / ac[0] > 0.45:
            f0s.append(rate / lag)
    return float(np.median(f0s)) if f0s else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--length-scale", type=float, default=1.1, help=">1 speaks more slowly (gentler)")
    ap.add_argument("--text", default=TEXT, help="other sentences are for test recordings only; the firmware greeting is TEXT")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "greeting_vi_xin_chao_16k.wav")
    args = ap.parse_args()
    pcm, rate = synthesize(args.model, args.length_scale, args.text)
    pad = np.zeros(rate // 5)
    x = resample(np.concatenate([pad, pcm, pad]), rate, OUT_RATE)
    wav = finish(trim(x, OUT_RATE), OUT_RATE)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(wav)
    samples = (len(wav) - 44) // 2
    f0 = median_f0(np.frombuffer(wav[44:], dtype="<i2").astype(np.float64) / 32768.0, OUT_RATE)
    print(f"wrote {args.out}")
    print(f"format: PCM mono 16-bit {OUT_RATE} Hz, {samples} samples = {samples / OUT_RATE * 1000:.0f} ms, {len(wav)} bytes")
    print(f"sha256: {hashlib.sha256(wav).hexdigest()}")
    print(f"source: piper {args.model.name}, synthesis rate {rate} Hz, length_scale {args.length_scale}")
    print(f"median F0 (proxy only): {f0:.0f} Hz" if f0 else "median F0: not found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
