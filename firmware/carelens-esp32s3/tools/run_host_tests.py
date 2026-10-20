"""Build and run the host unit tests of the hardware-independent firmware modules (WAV, PCM, JPEG, MP3, command ledger,
text helpers) with the PC's g++ (MSYS2 mingw64 on the development PC). Exit code 0 only when every check passes.
Our sources build with -Werror; the vendored dr_mp3 decoder (src/dr_mp3_impl.c) is compiled separately as C, like on the device.

Usage: python tools/run_host_tests.py
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ["src/wav.cpp", "src/pcm.cpp", "src/jpeg.cpp", "src/mp3.cpp", "src/ledger.cpp", "src/textutil.cpp", "test/host/test_main.cpp"]
C_SOURCES = ["src/dr_mp3_impl.c"]
CANDIDATES = [r"C:\msys64\mingw64\bin\g++.exe", r"C:\msys64\ucrt64\bin\g++.exe"]


def find_gxx() -> str | None:
    for c in CANDIDATES:
        if Path(c).is_file():
            return c
    return shutil.which("g++")


def main() -> int:
    gxx = find_gxx()
    if gxx is None:
        print("g++ not found (install MSYS2 mingw64 or put g++ on PATH)", file=sys.stderr)
        return 2
    env = {**os.environ, "PATH": str(Path(gxx).parent) + os.pathsep + os.environ.get("PATH", "")}
    with tempfile.TemporaryDirectory() as tmp:
        exe = Path(tmp) / "host_tests.exe"
        gcc = str(Path(gxx).with_name("gcc.exe" if gxx.lower().endswith(".exe") else "gcc"))
        objects = []
        for c in C_SOURCES:
            obj = Path(tmp) / (Path(c).stem + ".o")
            build = subprocess.run([gcc, "-std=c99", "-O2", "-c", "-o", str(obj), str(ROOT / c)], env=env, capture_output=True, text=True)
            if build.returncode != 0:
                print(build.stdout + build.stderr, file=sys.stderr)
                return build.returncode
            objects.append(str(obj))
        cmd = [gxx, "-std=c++17", "-O1", "-g", "-Wall", "-Wextra", "-Werror", "-o", str(exe), *[str(ROOT / s) for s in SOURCES], *objects]
        build = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if build.returncode != 0:
            print(build.stdout + build.stderr, file=sys.stderr)
            return build.returncode
        run = subprocess.run([str(exe), str(ROOT / "assets" / "greeting_vi_xin_chao_16k.wav"), str(ROOT / "test" / "fixtures" / "mp3")],
                             env=env, capture_output=True, text=True)
        print(run.stdout, end="")
        print(run.stderr, end="", file=sys.stderr)
        return run.returncode


if __name__ == "__main__":
    sys.exit(main())
