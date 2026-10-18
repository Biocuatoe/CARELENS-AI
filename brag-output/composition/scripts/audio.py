#!/usr/bin/env python3
"""Synthesises the soundtrack (music + sound effects) of the CareLens AI pitch video, 30.000 s, 44.1 kHz stereo.

Everything is generated procedurally with numpy (no samples, no third-party audio, no voice-over), so it is original and reproducible.
Tempo 120 BPM: every scene boundary (3, 8.5, 14, 19.5, 23.5, 26, 30 s) lands on a beat.

    python3 scripts/audio.py --out ../audio/soundtrack.wav
"""
import argparse
import wave

import numpy as np

SR = 44100
DUR = 30.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(1020)

mix_l = np.zeros(N)
mix_r = np.zeros(N)
# separate buses so the reverb only gets what we send to it
rev_l = np.zeros(N)
rev_r = np.zeros(N)


def tt(d):
    return np.arange(int(SR * d)) / SR


def db(x):
    return 10 ** (x / 20)


def adsr(n, a, d, s, r):
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    e = np.ones(n)
    a_n = min(a_n, n)
    if a_n:
        e[:a_n] = np.linspace(0, 1, a_n)
    d_end = min(n, a_n + d_n)
    if d_end > a_n:
        e[a_n:d_end] = np.linspace(1, s, d_end - a_n)
    e[d_end:] = s
    r_n = min(r_n, n)
    if r_n:
        e[n - r_n:] *= np.linspace(1, 0, r_n)
    return e


def place(sig, t0, gain=1.0, pan=0.0, send=0.0):
    """Mix `sig` (mono) at time t0 seconds. pan -1..1, send = reverb send (linear)."""
    i0 = int(round(t0 * SR))
    if i0 >= N or i0 + len(sig) <= 0:
        return
    s0 = max(0, -i0)
    i0 = max(0, i0)
    seg = sig[s0:s0 + (N - i0)]
    n = len(seg)
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    mix_l[i0:i0 + n] += seg * gain * l * 1.414
    mix_r[i0:i0 + n] += seg * gain * r * 1.414
    if send:
        rev_l[i0:i0 + n] += seg * gain * l * send
        rev_r[i0:i0 + n] += seg * gain * r * send


def addsig(a, b):
    n = max(len(a), len(b))
    out = np.zeros(n)
    out[: len(a)] += a
    out[: len(b)] += b
    return out


def hz(note):  # MIDI -> Hz
    return 440.0 * 2 ** ((note - 69) / 12)


def saw_add(f0, d, fc=lambda t: 4000.0, nh=28, detune=0.0):
    """Additive band-limited saw with a time-varying brightness (acts like a sweeping lowpass)."""
    t = tt(d)
    f = f0 * (1 + detune) if np.isscalar(f0) else f0
    ph = 2 * np.pi * np.cumsum(np.full_like(t, f) if np.isscalar(f) else f) / SR
    cut = fc(t)
    out = np.zeros_like(t)
    for k in range(1, nh + 1):
        fk = (f0 if np.isscalar(f0) else f0.mean()) * k
        if fk > 16000:
            break
        out += np.sin(k * ph) / k / (1 + (fk / cut) ** 4)
    return out * (2 / np.pi)


def noise_band(d, fc, bw, gain=None, seed=0):
    """Noise with a moving band-pass (STFT overlap-add). fc/bw: callables of time (s) -> Hz."""
    r = np.random.default_rng(seed)
    n = int(d * SR)
    x = r.standard_normal(n)
    frame, hop = 2048, 512
    win = np.hanning(frame)
    out = np.zeros(n + frame)
    freqs = np.fft.rfftfreq(frame, 1 / SR)
    for s in range(0, n - frame, hop):
        t = (s + frame / 2) / SR
        spec = np.fft.rfft(x[s:s + frame] * win)
        c, b = fc(t), bw(t)
        m = np.exp(-0.5 * ((np.log2(np.maximum(freqs, 1) / c)) / (b)) ** 2)
        out[s:s + frame] += np.fft.irfft(spec * m) * win
    out = out[:n]
    out /= np.max(np.abs(out)) + 1e-9
    if gain is not None:
        out *= gain(tt(d))
    return out


def lowpass(x, fc):
    """Zero-phase FFT lowpass (smooth knee)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))


def highpass(x, fc):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / (1 + (f / fc) ** 4)
    return np.fft.irfft(X, len(x))


# ------------------------------------------------------------------ instruments
def pad(notes, d, vel=1.0, bright=1800):
    n = int(d * SR)
    out = np.zeros(n)
    for i, m in enumerate(notes):
        for det in (-0.0035, 0.0, 0.0035):
            out += saw_add(hz(m) * (1 + det), d, fc=lambda t: bright * (0.6 + 0.4 * np.minimum(1, t / 1.2)), nh=14)
        out += 0.5 * np.sin(2 * np.pi * hz(m) * tt(d))
    out /= len(notes) * 2.2
    return out * adsr(n, 1.1, 0.4, 0.85, 1.4) * vel


def pluck(m, d=0.6, bright=3200):
    t = tt(d)
    f = hz(m)
    out = np.zeros_like(t)
    for k in range(1, 12):
        out += np.sin(2 * np.pi * f * k * t) / k * np.exp(-t * (3.5 + k * 2.2)) * (1 / (1 + (f * k / bright) ** 2))
    return out * adsr(len(t), 0.004, 0.0, 1.0, 0.05) * 0.8


def bell(m, d=2.2):
    t = tt(d)
    f = hz(m)
    out = np.zeros_like(t)
    for ratio, a, dec in [(1, 1.0, 1.6), (2.76, 0.35, 2.6), (5.4, 0.18, 4.0), (8.93, 0.08, 6.0)]:
        out += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * dec)
    return out * adsr(len(t), 0.002, 0, 1, 0.1) * 0.6


def sub(m, d):
    t = tt(d)
    return np.sin(2 * np.pi * hz(m) * t) * adsr(len(t), 0.02, 0.1, 0.8, 0.25)


def kick(g=1.0):
    t = tt(0.4)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * g


def hat(g=1.0, open_=False):
    d = 0.18 if open_ else 0.05
    x = highpass(rng.standard_normal(int(SR * d)), 7000)
    return x * np.exp(-tt(d) * (18 if open_ else 70)) * g


def clap(g=1.0):
    d = 0.22
    x = highpass(lowpass(rng.standard_normal(int(SR * d)), 5200), 900)
    t = tt(d)
    e = np.exp(-t * 26) + 0.6 * np.exp(-np.clip(t - 0.012, 0, None) * 30) * (t > 0.012)
    return x * e * g


def blip(f, d=0.09, g=1.0):
    t = tt(d)
    return np.sin(2 * np.pi * f * t) * adsr(len(t), 0.004, 0.02, 0.5, 0.05) * g + 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 40) * g


def click(g=1.0, f=1800, d=0.03):
    t = tt(d)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 220) + highpass(rng.standard_normal(len(t)), 2500) * np.exp(-t * 260) * 0.8
    return x * g


def thunk(g=1.0, f=140, d=0.12):
    t = tt(d)
    x = np.sin(2 * np.pi * (f + 90 * np.exp(-t * 60)) * t) * np.exp(-t * 36)
    x += highpass(rng.standard_normal(len(t)), 1500) * np.exp(-t * 120) * 0.35
    return x * g


def whoosh(d, f0, f1, g=1.0, seed=1, shape="sin"):
    k = (lambda t: np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5) if shape == "sin" else (lambda t: np.clip(t / d, 0, 1) ** 2.2)
    return noise_band(d, lambda t: f0 * (f1 / f0) ** (t / d), lambda t: 1.2, gain=k, seed=seed) * g


def reverb_ir(d=2.6, pre=0.012):
    n = int(d * SR)
    t = tt(d)
    ir_l = rng.standard_normal(n) * np.exp(-t * 2.3)
    ir_r = rng.standard_normal(n) * np.exp(-t * 2.3)
    ir_l = lowpass(ir_l, 7000)
    ir_r = lowpass(ir_r, 7000)
    ir_l[: int(pre * SR)] = 0
    ir_r[: int(pre * SR * 1.3)] = 0
    return ir_l / np.sqrt(np.sum(ir_l ** 2)), ir_r / np.sqrt(np.sum(ir_r ** 2))


def fft_conv(x, ir):
    n = len(x) + len(ir)
    nfft = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]


def delay_feedback(x, time, fb, mix, n_rep=4):
    out = x.copy()
    d = int(time * SR)
    for i in range(1, n_rep + 1):
        out[d * i:] += x[: len(x) - d * i] * (fb ** i) * mix
    return out


# ------------------------------------------------------------------ composition
# chord progression, 4 beats (2 s) per bar: Bm - G - D - A (then repeats). Voicings are MIDI notes.
BARS = {
    "Bm": ([47, 54, 59, 62, 66], 35),
    "G": ([43, 55, 59, 62, 67], 31),
    "D": ([50, 57, 62, 66, 69], 38),
    "A": ([45, 57, 61, 64, 69], 33),
}
CYCLE = ["Bm", "G", "D", "A"]


def bar_chord(t):
    return CYCLE[int(t // 2) % 4]


# ---- pads / bass / arp (music bed)
def music():
    # pad: always present, swells in; dark and filtered at first, brightens at the reveal (3 s)
    for bar in range(0, 12):
        t0 = bar * 2.0
        if t0 >= 26.0:
            break
        name = CYCLE[bar % 4]
        notes, root = BARS[name]
        lvl = np.interp(t0, [0, 3, 8.5, 19.5, 23.5, 26], [0.16, 0.26, 0.34, 0.32, 0.30, 0.0])
        bright = np.interp(t0, [0, 3, 8.5, 20], [700, 1500, 2300, 1700])
        place(pad(notes[1:], 2.6, bright=bright), t0, lvl, pan=0.0, send=0.35)
        # sub only from the reveal until the privacy scene
        if 3.0 <= t0 < 19.5:
            place(sub(root, 1.9), t0, 0.33)
        elif 19.5 <= t0 < 24.0:
            place(sub(root, 1.9), t0, 0.24)
        elif t0 < 3.0:
            place(sub(root, 1.9), t0, 0.14 + 0.05 * t0)
        if bar == 0:
            place(sub(35, 3.2), 0, 0.12)  # first drone
    # resolve: warm Dmaj add9 from 26.0 (D F# A E) with a high airy layer, sustained to the end
    warm = [50, 57, 62, 66, 69, 74, 76]
    p = pad(warm, 4.6, bright=3600)
    place(p, 25.95, 0.42, send=0.5)
    place(pad([62, 66, 69, 74], 4.2, bright=5200), 26.0, 0.18, pan=0.25, send=0.6)
    place(sub(38, 4.2), 26.0, 0.28)

    # arpeggio (plucks, 8th notes) from the reveal to the end of the privacy scene, then a thinner version
    pattern = [0, 2, 1, 3, 2, 4, 3, 1]
    t = 3.0
    while t < 23.5:
        name = bar_chord(t)
        notes, _ = BARS[name]
        step = int(round((t - 3.0) / 0.25))
        n = notes[1:][pattern[step % 8] % 4] + 12
        lvl = np.interp(t, [3, 8.5, 14, 19.5, 23.5], [0.22, 0.3, 0.3, 0.26, 0.2])
        if 19.5 <= t < 23.5:
            if step % 2 == 0:
                place(pluck(n + 12, 0.9), t, lvl * 0.9, pan=((step % 4) - 1.5) * 0.35, send=0.5)
        else:
            place(pluck(n, 0.5), t, lvl, pan=((step % 4) - 1.5) * 0.35, send=0.3)
        t += 0.25

    # drums: soft four-on-the-floor from 3.0 to 19.5, back for the pulse before the photo (see riser)
    for k in range(int((19.5 - 3.0) / BEAT)):
        t0 = 3.0 + k * BEAT
        g = np.interp(t0, [3, 8.5, 19.5], [0.5, 0.7, 0.6])
        place(kick(), t0, g * 0.55, pan=0.0)
        place(hat(), t0 + 0.25, 0.1 * g, pan=0.25)
        if k % 2 == 1:
            place(clap(), t0, 0.12 * g, pan=-0.1, send=0.25)
    # 14.0: a small lift (open hat + octave pluck run)
    place(hat(1.0, True), 14.0, 0.14)
    # warm bell melody over the resolve (D major pentatonic, gentle)
    mel = [(26.55, 81), (27.05, 78), (27.55, 76), (28.05, 74), (28.55, 78), (29.05, 81), (29.55, 86)]
    for t0, m in mel:
        place(bell(m, 2.2), t0, 0.22, pan=0.2 * np.sin(t0), send=0.5)
    # privacy section: sparse bell tones under the text
    for t0, m in [(21.25, 74), (21.9, 71), (22.5, 66), (23.0, 69)]:
        place(bell(m, 1.8), t0, 0.14, pan=-0.2, send=0.5)


# ---- sound effects
def sfx():
    # 0.0: electronic activation (power-up): sub thump + rising zip + shimmer
    place(thunk(0.8, 70, 0.4), 0.0, 0.5)
    t = tt(0.9)
    f = 90 * (2 ** (t / 0.9 * 5))
    zip_ = np.sin(2 * np.pi * np.cumsum(f) / SR) * adsr(len(t), 0.02, 0, 1, 0.25) * 0.5
    place(zip_, 0.04, 0.22, pan=0.0, send=0.25)
    place(blip(1320, 0.5, 0.5) * np.exp(-tt(0.5) * 5), 0.65, 0.12, pan=0.2, send=0.5)
    # highlight sweep along the enclosure (0.3 -> 2.4), shimmering band that rises and narrows toward the lens
    sw = noise_band(2.4, lambda t: 1800 + 3200 * (t / 2.4), lambda t: 0.9 - 0.5 * t / 2.4, gain=lambda t: np.sin(np.pi * np.clip(t / 2.4, 0, 1)) ** 1.3, seed=7)
    swl = sw * 0.16
    n = len(swl)
    pan_curve = np.linspace(-0.7, 0.2, n)
    segl = swl * np.cos((pan_curve + 1) * np.pi / 4) * 1.414
    segr = swl * np.sin((pan_curve + 1) * np.pi / 4) * 1.414
    i0 = int(0.3 * SR)
    mix_l[i0:i0 + n] += segl
    mix_r[i0:i0 + n] += segr
    rev_l[i0:i0 + n] += segl * 0.4
    rev_r[i0:i0 + n] += segr * 0.4
    # riser into the reveal (1.5 -> 3.0) and the impact at 3.0
    ris = noise_band(1.5, lambda t: 400 * (12 ** (t / 1.5)), lambda t: 1.3, gain=lambda t: (t / 1.5) ** 2, seed=11)
    place(ris, 1.5, 0.28, send=0.3)
    place(thunk(1.0, 52, 0.7), 3.0, 0.62)
    place(whoosh(0.8, 6000, 700, 0.5, seed=3), 3.0, 0.3, send=0.3)
    place(bell(74, 3.0), 3.0, 0.3, send=0.7)
    place(bell(81, 3.0), 3.02, 0.16, pan=0.3, send=0.7)

    # 3.9: lid latch + slide (3.9 -> 4.9)
    place(click(1.0, 1500), 3.9, 0.5, pan=-0.1)
    place(thunk(0.7, 190, 0.09), 3.92, 0.35)
    slide = noise_band(1.0, lambda t: 900 + 1800 * np.sin(np.pi * t / 1.0), lambda t: 0.8, gain=lambda t: np.sin(np.pi * np.clip(t, 0, 1)) ** 2, seed=21)
    place(slide, 3.95, 0.14, pan=0.1)
    place(thunk(0.8, 120, 0.15), 4.9, 0.35)  # lid seated at its station
    place(click(1.0, 2300), 4.9, 0.3)
    # component separation: a small mechanical click-whirr at each start and a soft tick when it lands
    starts = [0.0, 0.04, 0.12, 0.2, 0.28, 0.4, 0.52, 0.68]
    ends = [0.2, 0.24, 0.34, 0.42, 0.54, 0.66, 0.8, 1.0]
    pans = [-0.6, 0.5, -0.3, 0.3, 0.0, 0.6, -0.5, 0.2]
    for s, e, p in zip(starts, ends, pans):
        ts, te = 4.9 + 2.0 * s, 4.9 + 2.0 * e
        place(click(0.9, 1400 + 700 * rng.random()), ts, 0.28, pan=p)
        w = noise_band(0.18, lambda t: 1400, lambda t: 0.6, gain=lambda t: np.sin(np.pi * np.clip(t / 0.18, 0, 1)), seed=int(s * 100) + 30)
        place(w, ts + 0.02, 0.1, pan=p)
        place(thunk(0.7, 210 + 90 * rng.random(), 0.07), te, 0.22, pan=p)
    # label blips (5.55 -> 6.2)
    for i in range(7):
        place(blip(880 * 2 ** (i / 12 * 2), 0.08, 0.7), 5.55 + i * 0.1 + (0.05 if i >= 4 else 0), 0.13, pan=-0.4 if i < 4 else 0.4, send=0.2)
    # close-up cards
    place(blip(1568, 0.12, 0.8), 6.95, 0.16, send=0.3)
    place(blip(1760, 0.12, 0.8), 7.9, 0.16, send=0.3)
    place(whoosh(0.55, 1500, 3500, 0.5, seed=5, shape="sin"), 6.9, 0.16, pan=0.1)
    # 8.5: flash transition (swoosh + soft chime)
    place(whoosh(0.7, 800, 9000, 0.8, seed=9, shape="up"), 8.0, 0.3, send=0.35)
    place(bell(86, 2.0), 8.5, 0.22, send=0.6)
    place(bell(93, 2.0), 8.52, 0.1, pan=0.3, send=0.6)

    # scene 3 (fall): ring pulse, pipeline pings, card pop, button press, acknowledged chime
    place(thunk(0.8, 85, 0.4), 10.35, 0.22)
    place(blip(660, 0.5, 0.6) * np.exp(-tt(0.5) * 4), 10.9, 0.14, send=0.5)
    for i, f in enumerate([784, 988, 1175, 1480]):
        place(blip(f, 0.1, 0.8), 11.1 + i * 0.3, 0.12, pan=-0.3 + 0.2 * i, send=0.3)
    place(blip(1320, 0.14, 0.8), 11.85, 0.15, send=0.3)
    place(click(1.0, 2000), 13.3, 0.4)
    place(blip(1047, 0.18, 0.9), 13.5, 0.14, send=0.4)
    place(blip(1568, 0.3, 0.9) * np.exp(-tt(0.3) * 6), 13.6, 0.14, send=0.5)

    # 14.0: crossfade to the medication day
    place(whoosh(0.5, 600, 3000, 0.6, seed=13), 13.75, 0.2)
    for i in range(6):
        place(click(0.6, 2600), 14.15 + i * 0.14, 0.08, pan=-0.3 + 0.12 * i)
    # speaker reminder chime (two notes) at 14.95
    place(bell(79, 1.6), 14.95, 0.28, send=0.5)
    place(bell(74, 1.8), 15.2, 0.28, send=0.5)
    # 15.5: into the 3D scene
    place(whoosh(0.5, 400, 2500, 0.6, seed=17), 15.2, 0.16)
    # camera observing (16.5) and data packet (17.2-18.0) glints; note card pop at 17.8, rule at 18.45
    place(blip(1568, 0.12, 0.8), 16.55, 0.12, send=0.3)
    place(whoosh(0.9, 700, 4000, 0.6, seed=19), 17.1, 0.16, pan=0.2)
    place(blip(1976, 0.12, 0.8), 17.8, 0.14, send=0.3)
    place(thunk(0.8, 90, 0.3), 18.45, 0.2)

    # 19.5: privacy. data -> text 'digital shimmer' collapsing into a clean tone, then three line blips
    place(noise_band(0.9, lambda t: 5200 - 3800 * (t / 0.9), lambda t: 0.7, gain=lambda t: np.sin(np.pi * np.clip(t / 0.9, 0, 1)), seed=23), 20.35, 0.14, pan=0.3)
    place(blip(1175, 0.2, 0.9) * np.exp(-tt(0.2) * 7), 21.2, 0.12, send=0.4)
    for t0, f in [(21.25, 988), (21.9, 784), (22.5, 659)]:
        place(blip(f, 0.12, 0.9), t0, 0.14, send=0.3)
    place(blip(1568, 0.14, 0.9), 22.8, 0.1, pan=0.3, send=0.3)

    # 23.5 -> 25.3: tension riser, quickening pulse, shutter, flash
    place(noise_band(1.9, lambda t: 300 * (30 ** (t / 1.9)), lambda t: 1.4, gain=lambda t: (t / 1.9) ** 2.2, seed=29), 23.4, 0.34, send=0.25)
    rt = tt(1.9)
    f = 110 * 2 ** (rt / 1.9 * 3.2)
    place(np.sin(2 * np.pi * np.cumsum(f) / SR) * (rt / 1.9) ** 2 * 0.5, 23.4, 0.14, send=0.3)
    beats = []
    t = 23.55
    gap = 0.5
    while t < 25.2:
        beats.append(t)
        t += gap
        gap = max(0.12, gap * 0.8)
    for b in beats:
        place(thunk(0.9, 62, 0.2), b, 0.3)
        place(click(0.7, 3000), b + 0.01, 0.08)
    # light gathering around the lens
    place(pad([62, 69, 74, 78], 1.8, bright=5200), 23.6, 0.22, send=0.6)
    place(blip(2093, 1.2, 0.5) * np.exp(-tt(1.2) * 1.6) * adsr(int(1.2 * SR), 0.9, 0, 1, 0.1), 24.0, 0.08, pan=0.2, send=0.5)
    # shutter: a clear two-part mechanical click (open, close) at 25.22 / 25.30 plus the flash whoosh and ring
    sh1 = addsig(click(1.0, 900, 0.05), thunk(0.7, 260, 0.05) * 0.8)
    sh2 = addsig(click(0.9, 1400, 0.045), thunk(0.6, 190, 0.05) * 0.7)
    place(sh1, 25.22, 0.8)
    place(sh2, 25.30, 0.6, pan=0.05)
    place(highpass(rng.standard_normal(int(0.07 * SR)), 3500) * np.exp(-tt(0.07) * 45), 25.22, 0.5)
    place(whoosh(0.55, 500, 12000, 1.0, seed=31, shape="up"), 24.85, 0.34, send=0.3)
    place(np.sin(2 * np.pi * 7800 * tt(1.4)) * np.exp(-tt(1.4) * 3.2), 25.3, 0.07, send=0.4)
    place(thunk(1.0, 48, 0.9), 25.3, 0.5)
    place(whoosh(1.0, 9000, 400, 0.7, seed=33), 25.35, 0.18, send=0.5)
    # 26.0: warm swell of the greeting
    place(whoosh(0.9, 500, 3000, 0.7, seed=37), 25.7, 0.12)
    place(bell(74, 3.0), 26.0, 0.24, send=0.7)
    place(bell(66, 3.0), 26.03, 0.18, pan=-0.3, send=0.7)
    place(bell(81, 3.0), 26.06, 0.12, pan=0.3, send=0.7)
    # soft sparkle for the 20/10 numerals
    for i, m in enumerate([93, 98, 95, 100]):
        place(bell(m, 1.4), 26.8 + i * 0.09, 0.08, pan=-0.4 + 0.27 * i, send=0.6)


def master(out_path):
    music()
    sfx()
    # reverb bus
    irl, irr = reverb_ir(2.8)
    wl = fft_conv(rev_l + 0.0, irl)
    wr = fft_conv(rev_r + 0.0, irr)
    l = mix_l + wl * 0.8
    r = mix_r + wr * 0.8
    # gentle bus: highpass 30 Hz, soft-clip
    l = highpass(l, 30)
    r = highpass(r, 30)
    peak = max(np.max(np.abs(l)), np.max(np.abs(r)))
    l, r = l / peak * 0.9, r / peak * 0.9
    l, r = np.tanh(l * 1.25) / np.tanh(1.25), np.tanh(r * 1.25) / np.tanh(1.25)
    # fades: very short fade-in (click-free), warm fade-out over the last 0.9 s
    fade_in = np.minimum(1, np.arange(N) / (0.004 * SR))
    fade_out = np.minimum(1, (N - np.arange(N)) / (0.9 * SR))
    fade_out = fade_out ** 1.6
    l, r = l * fade_in * fade_out, r * fade_in * fade_out
    st = np.stack([l, r], axis=1)
    pcm = (np.clip(st, -1, 1) * 32767 * 0.89).astype("<i2")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"wrote {out_path}: {N / SR:.3f} s, peak {np.max(np.abs(st)):.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    master(ap.parse_args().out)
