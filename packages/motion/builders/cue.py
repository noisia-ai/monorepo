#!/usr/bin/env python3
"""
cue.py: the insight cue, the short sound that lands with every Creative Spark (VIDEO.md §5.3).

    python3 builders/cue.py                       # rewrites public/sfx/insight.wav, the kit's cue
    python3 builders/cue.py out.wav --notes 62 69 # another cue (MIDI notes), e.g. for a test

Two bell notes (D and A by default), 0.55 s, peak at -14 dBFS. Synthesised with the standard
library, no API call, so it comes out identical every time and every Noisia video sounds the same.
A piece uses it with "sfx": {"insight": "kit"}.
"""
import argparse, math, os, struct, wave

RATE = 44100


def bell(freq, t):
    # A bell is a few inharmonic partials that decay at their own pace.
    partials = ((1.0, 1.0, 5.0), (2.76, 0.42, 8.0), (5.4, 0.18, 12.0))
    return sum(a * math.exp(-d * t) * math.sin(2 * math.pi * freq * r * t) for r, a, d in partials)


def render(notes, length=0.55, gap=0.11, peak_db=-14.0):
    n = int(RATE * length)
    out = [0.0] * n
    for k, midi in enumerate(notes):
        freq = 440.0 * 2 ** ((midi - 69) / 12)
        start = int(RATE * gap * k)
        for i in range(start, n):
            t = (i - start) / RATE
            out[i] += bell(freq, t) * min(1.0, t / 0.004)    # 4 ms attack, no click
    fade = int(RATE * 0.06)
    for i in range(fade):
        out[n - 1 - i] *= i / fade
    top = max(abs(x) for x in out) or 1.0
    gain = 10 ** (peak_db / 20) / top
    return [x * gain for x in out]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=os.path.join(here, "..", "public", "sfx", "insight.wav"))
    ap.add_argument("--notes", nargs="+", type=int, default=[62, 69])
    a = ap.parse_args()
    samples = render(a.notes)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with wave.open(a.out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x)) * 32767)) for x in samples))
    print(f"{os.path.abspath(a.out)} · {len(samples) / RATE:.2f} s · notes {a.notes}")


if __name__ == "__main__":
    main()
