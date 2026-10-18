#!/usr/bin/env python3
"""Validates brag.mp4 against the brief (exists, plays, 30.000 s, 1920x1080, 30 fps, audio present, poster + share copy present).

    python3 scripts/validate.py <out_dir>
"""
import json
import pathlib
import subprocess
import sys

out = pathlib.Path(sys.argv[1])
res = []


def check(name, ok, detail=""):
    res.append(ok)
    print(("PASS" if ok else "FAIL"), name, detail)


mp4 = out / "brag.mp4"
check("brag.mp4 exists", mp4.is_file(), f"{mp4.stat().st_size / 1e6:.2f} MB" if mp4.is_file() else "")
probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(mp4)], capture_output=True, text=True).stdout)
v = next(s for s in probe["streams"] if s["codec_type"] == "video")
a = next((s for s in probe["streams"] if s["codec_type"] == "audio"), None)
num, den = map(int, v["avg_frame_rate"].split("/"))
fmt_dur = float(probe["format"]["duration"])
check("video codec h264 / yuv420p", v["codec_name"] == "h264" and v["pix_fmt"] == "yuv420p", f'{v["codec_name"]} {v["pix_fmt"]}')
check("resolution 1920x1080", (v["width"], v["height"]) == (1920, 1080), f'{v["width"]}x{v["height"]}')
check("frame rate 30 fps", num / den == 30.0, f"{num}/{den}")
nb = int(v.get("nb_frames", 0))
check("900 video frames", nb == 900, str(nb))
check("duration exactly 30.000 s", abs(fmt_dur - 30.0) < 0.0005 and abs(float(v["duration"]) - 30.0) < 0.0005, f'container {fmt_dur:.4f}s, video stream {v["duration"]}s')
check("audio stream present (AAC stereo)", a is not None and a["codec_name"] == "aac" and a["channels"] == 2, f'{a["codec_name"]} {a["channels"]}ch {a["duration"]}s' if a else "none")
# full decode, no errors
dec = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp4), "-f", "null", "-"], capture_output=True, text=True)
check("full decode without errors (plays)", dec.returncode == 0 and not dec.stderr.strip(), dec.stderr.strip()[:200])
check("brag.jpg exists", (out / "brag.jpg").is_file())
check("share-copy.txt exists", (out / "share-copy.txt").is_file() and (out / "share-copy.txt").stat().st_size > 20)
check("brag-plan.md exists", (out / "brag-plan.md").is_file())
check("composition/ exists", (out / "composition" / "src" / "main.tsx").is_file())
sys.exit(0 if all(res) else 1)
