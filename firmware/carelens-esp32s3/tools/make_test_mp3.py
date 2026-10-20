"""Make MP3 files for tests and assets with LAME (the `lameenc` package), never at run time.

  fixtures   synthetic tone fixtures for the host tests (test/fixtures/mp3/): every MP3 sample-rate family, mono and
             stereo, CBR and VBR, ID3v2/ID3v1 tags. Tones only, no voices.
  encode     one WAV (16-bit PCM) to MP3, e.g. the greeting asset or a TTS test message:
             python tools/make_test_mp3.py encode in.wav out.mp3 --kbps 48 [--rate 16000] [--channels 1|2] [--vbr] [--repeat N]

Dev-only dependency: pip install lameenc numpy (installed in a separate virtual environment, not in the firmware).
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import wave
from pathlib import Path

import lameenc
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "test" / "fixtures" / "mp3"


def tone(rate: int, seconds: float, channels: int, hz: float = 440.0, hz_right: float = 660.0) -> np.ndarray:
    t = np.arange(int(rate * seconds)) / rate
    ramp = np.minimum(1.0, np.minimum(t, t[::-1]) / 0.02)  # 20 ms fade in/out, no clicks
    left = 0.5 * np.sin(2 * np.pi * hz * t) * ramp
    if channels == 1:
        return np.round(left * 32767).astype("<i2")
    right = 0.5 * np.sin(2 * np.pi * hz_right * t) * ramp
    return np.round(np.stack([left, right], axis=1).reshape(-1) * 32767).astype("<i2")


def resample(pcm: np.ndarray, channels: int, rate_in: int, rate_out: int) -> np.ndarray:
    """Linear interpolation per channel (test material: speech and tones), so LAME itself never resamples."""
    if rate_in == rate_out:
        return pcm
    frames = pcm.reshape(-1, channels).astype(np.float64)
    n_out = int(round(len(frames) * rate_out / rate_in))
    t_in = np.arange(len(frames)) / rate_in
    t_out = np.arange(n_out) / rate_out
    out = np.stack([np.interp(t_out, t_in, frames[:, c]) for c in range(channels)], axis=1)
    return np.clip(np.round(out), -32768, 32767).astype("<i2").reshape(-1)


def encode(pcm: np.ndarray, in_rate: int, channels: int, kbps: int, out_rate: int | None = None, vbr: bool = False) -> bytes:
    rate = out_rate or in_rate
    pcm = resample(pcm, channels, in_rate, rate)
    enc = lameenc.Encoder()
    enc.set_in_sample_rate(rate)
    enc.set_out_sample_rate(rate)
    enc.set_channels(channels)
    enc.set_quality(2)
    if vbr:
        enc.set_vbr(4)
        enc.set_vbr_quality(4)
    else:
        enc.set_bit_rate(kbps)
    out = bytearray()
    step = 1152 * 32 * channels  # whole frames per call keep LAME's output buffer small
    for i in range(0, len(pcm), step):
        out += enc.encode(pcm[i : i + step].tobytes())
    out += enc.flush()
    return bytes(out)


def id3v2(text: str) -> bytes:
    frame = b"TIT2" + struct.pack(">I", len(text) + 1) + b"\x00\x00" + b"\x00" + text.encode("latin-1")
    size = len(frame) + 64  # 64 bytes of padding inside the tag
    syncsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x03\x00\x00" + syncsafe + frame + b"\x00" * 64


def id3v1(title: str) -> bytes:
    return b"TAG" + title.encode("latin-1").ljust(30, b"\x00") + b"\x00" * 94 + b"\xff"


# name, sample rate, channels, kbps (0 = VBR), seconds
SPECS = [
    ("mpeg25_8k_mono_16k", 8000, 1, 16, 1.0),
    ("mpeg2_16k_mono_32k", 16000, 1, 32, 1.0),
    ("mpeg2_22k_mono_48k", 22050, 1, 48, 1.0),
    ("mpeg2_24k_stereo_64k", 24000, 2, 64, 1.0),
    ("mpeg1_32k_stereo_96k", 32000, 2, 96, 1.0),
    ("mpeg1_44k_stereo_128k", 44100, 2, 128, 1.5),
    ("mpeg1_48k_stereo_320k", 48000, 2, 320, 1.0),
    ("mpeg1_44k_mono_vbr", 44100, 1, 0, 1.5),
]


def fixtures() -> int:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, rate, ch, kbps, secs in SPECS:
        data = encode(tone(rate, secs, ch), rate, ch, kbps, vbr=kbps == 0)
        (FIXTURES / f"{name}.mp3").write_bytes(data)
        manifest.append({"file": f"{name}.mp3", "sample_rate": rate, "channels": ch, "kbps": kbps, "source_seconds": secs, "tone_hz": 440, "bytes": len(data)})
    tagged = id3v2("CareLens test tone") + encode(tone(16000, 1.0, 1), 16000, 1, 32) + id3v1("CareLens test tone")
    (FIXTURES / "tagged_16k_mono_32k.mp3").write_bytes(tagged)
    manifest.append({"file": "tagged_16k_mono_32k.mp3", "sample_rate": 16000, "channels": 1, "kbps": 32, "source_seconds": 1.0, "tone_hz": 440, "bytes": len(tagged), "tags": ["id3v2", "id3v1"]})
    (FIXTURES / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for m in manifest:
        print(f"{m['file']:32} {m['bytes']:6} bytes")
    return 0


def encode_wav(src: Path, dst: Path, kbps: int, rate: int | None, channels: int | None, vbr: bool, repeat: int = 1) -> int:
    with wave.open(str(src), "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit("input must be 16-bit PCM WAV")
        in_rate, in_ch = w.getframerate(), w.getnchannels()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    if channels == 1 and in_ch == 2:
        pcm = pcm.reshape(-1, 2).mean(axis=1).round().astype("<i2")
        in_ch = 1
    elif channels == 2 and in_ch == 1:  # the same signal on both channels: a stereo file of a mono recording
        pcm = np.repeat(pcm, 2)
        in_ch = 2
    if repeat > 1:
        pcm = np.tile(pcm, repeat)
    data = encode(pcm, in_rate, in_ch, kbps, rate, vbr)
    dst.write_bytes(data)
    print(f"{dst.name}: {len(data)} bytes ({in_rate} Hz in, {rate or in_rate} Hz out, {in_ch} ch, {'VBR' if vbr else f'{kbps} kbps'}, x{repeat})")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fixtures")
    e = sub.add_parser("encode")
    e.add_argument("src", type=Path)
    e.add_argument("dst", type=Path)
    e.add_argument("--kbps", type=int, default=48)
    e.add_argument("--rate", type=int)
    e.add_argument("--channels", type=int, choices=[1, 2])
    e.add_argument("--vbr", action="store_true")
    e.add_argument("--repeat", type=int, default=1, help="play the recording N times in a row (long-playback tests)")
    a = ap.parse_args()
    if a.cmd == "fixtures":
        return fixtures()
    return encode_wav(a.src, a.dst, a.kbps, a.rate, a.channels, a.vbr, a.repeat)


if __name__ == "__main__":
    sys.exit(main())
