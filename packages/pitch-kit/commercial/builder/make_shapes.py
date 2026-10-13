#!/usr/bin/env python3
"""
make_shapes.py — the Noisia bloom: abstract colour fields for commercial covers and backgrounds.

    python3 commercial/builder/make_shapes.py --build            # writes assets/shapes/*.jpg
    python3 commercial/builder/make_shapes.py --build --only cover,closing
    python3 commercial/builder/make_shapes.py --sheet out.png    # every composition, to review

What it draws, as agreed with the brand (oct 2026): no outlined shape the eye can name, but a
colour field that blooms and dissolves into the white canvas.

  · Density: a few anisotropic gaussian blobs, domain-warped by low-frequency waves so the field
    flows like a mesh gradient and never reads as a drawn object.
  · Colour: a second warped field places cyan and red. At the edges they are muted and dusty; where
    the field is densest they saturate towards the official #00EEEE and #EE0B00, and the very core
    sinks into the brand's deep #061218.
  · Edges: the alpha falls off with a long smoothstep and is dithered with grain, so the colour
    dissolves into white with no rim or halo.
  · Grain: intense luminance noise over the colour, a whisper over the white. The grain is what
    sets these apart from a generic gradient.

Covers, statements and closings carry a large bloom on the right (text lives on the left). Content
slides carry a small, faint bloom on the middle of an edge: every corner holds chrome (logo,
noisia.ai, the tagline, the slide number). Output is opaque JPEG on white, used as the slide
background by noisia_pptx.py.
"""
import argparse, math, os, warnings
import numpy as np
from PIL import Image, ImageFilter

warnings.filterwarnings("ignore", category=DeprecationWarning)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "shapes"))

CYAN, RED, DEEP = (0, 238, 238), (238, 11, 0), (6, 18, 24)          # tokens: signal, tension, blob-dark
NAVY = (14, 42, 68)                                                 # the deep blue of the reference
MUTED = {"cyan": (112, 190, 202), "red": (214, 104, 116),            # what the colour fades into
         "navy": (96, 126, 156), "pink": (232, 162, 178)}

# Each composition: seed, blobs (cx, cy, rx, ry, rotation, weight) in canvas fractions, overall
# strength (1 = covers, lower = content backgrounds), and the red share of the colour field (0..1).
COMPOSITIONS = {
    "cover":     dict(seed=11, strength=1.0, red=0.5,
                      blobs=[(0.78, 0.42, 0.20, 0.13, 0.5, 1), (0.92, 0.70, 0.16, 0.10, -0.4, 1),
                             (0.66, 0.70, 0.12, 0.08, 0.9, .8), (0.98, 0.22, 0.14, 0.10, 0.2, .7)]),
    "closing":   dict(seed=23, strength=1.0, red=0.66, colour=(3, 1.1, 1.6, 0.12),
                      blobs=[(0.80, 0.55, 0.22, 0.14, -0.3, 1), (0.95, 0.25, 0.14, 0.10, 0.6, .8),
                             (0.68, 0.82, 0.12, 0.08, 0.2, .7)]),
    "statement": dict(seed=31, strength=0.95, red=0.55, colour=(3, 1.1, 1.6, 0.12),
                      blobs=[(0.70, 0.10, 0.26, 0.10, 0.1, 1), (0.95, 0.30, 0.14, 0.12, -0.5, .8),
                             (0.55, 0.02, 0.14, 0.06, 0.0, .6)]),
    "frag-1":    dict(seed=41, strength=0.55, red=0.4, colour=(3, 1.0, 1.6, 0.3), blobs=[(0.99, 0.45, 0.13, 0.20, 0.2, 1)]),
    "frag-2":    dict(seed=42, strength=0.52, red=0.6, colour=(3, 1.0, 1.6, 0.3), blobs=[(0.55, 1.00, 0.20, 0.10, 0.1, 1)]),
    "frag-3":    dict(seed=43, strength=0.52, red=0.5, colour=(3, 1.0, 1.6, 0.3), blobs=[(0.01, 0.50, 0.12, 0.20, -0.2, 1)]),
    "frag-4":    dict(seed=44, strength=0.52, red=0.35, colour=(3, 1.0, 1.6, 0.3), blobs=[(0.99, 0.62, 0.13, 0.18, 0.4, 1)]),
    "frag-5":    dict(seed=45, strength=0.50, red=0.55, colour=(3, 1.0, 1.6, 0.3), blobs=[(0.40, 1.00, 0.19, 0.09, -0.1, 1)]),
    "frag-6":    dict(seed=46, strength=0.52, red=0.45, colour=(3, 1.0, 1.6, 0.3), blobs=[(0.01, 0.38, 0.12, 0.19, 0.3, 1)]),
    "onepager":  dict(seed=51, strength=0.5, red=0.5, size=(1191, 1684), colour=(3, 1.0, 1.6, 0.3),
                      blobs=[(1.0, 0.86, 0.22, 0.10, 0.3, 1)]),
}


def bloom(seed=11, strength=1.0, red=0.5, blobs=(), size=(1920, 1080), colour=(4, 1.4, 3.2, 0.0)):
    """`colour` = (waves, amplitude, frequency, floor) of the field that places navy, cyan and
    red. Fewer, slower waves give broad zones; a floor above 0 keeps navy out of small blooms."""
    W, H = size
    S = 4                                       # the field is low frequency: compute at 1/4 size
    w, h = W // S, H // S
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    X, Y = xx / w, yy / h

    def lowfreq(n, amp, k=3.2):
        f = np.zeros_like(X)
        for _ in range(n):
            kx, ky = rng.uniform(-k, k, 2)
            f += np.sin((kx * X * 1.7 + ky * Y) * math.pi + rng.uniform(0, 2 * math.pi))
        return f / n * amp

    Xw, Yw = X + lowfreq(5, 0.16), Y + lowfreq(5, 0.16)
    D = np.zeros_like(X)
    for cx, cy, rx, ry, rot, wt in blobs:
        c, s = math.cos(rot), math.sin(rot)
        dx, dy = Xw - cx, (Yw - cy) * (h / w)
        u, v = dx * c + dy * s, -dx * s + dy * c
        D += wt * np.exp(-((u / rx) ** 2 + (v / ry) ** 2))
    D /= max(D.max(), 1e-6)
    alpha = np.clip((D - 0.12) / 0.75, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha) * strength

    # where cyan and where red: a warped field, biased by the composition's red share
    n, amp, k, floor = colour
    t = np.clip(0.5 + lowfreq(n, amp, k=k) + (red - 0.5) * 0.8, floor, 1)
    pos = [0.0, 0.3, 0.62, 1.0]
    muted = np.array([MUTED["navy"], MUTED["cyan"], MUTED["red"], MUTED["pink"]], np.float32)
    strong = np.array([NAVY, CYAN, RED, (238, 40, 60)], np.float32)
    rgb_m = np.stack([np.interp(t, pos, muted[:, k]) for k in range(3)], -1)
    rgb_s = np.stack([np.interp(t, pos, strong[:, k]) for k in range(3)], -1)
    # saturate towards the official colours only where the field is dense
    sat = (np.clip((D - 0.42) / 0.5, 0, 1) ** 1.4 * 0.78)[..., None]
    rgb = rgb_m * (1 - sat) + rgb_s * sat
    core = (np.clip((D - 0.78) / 0.22, 0, 1) ** 1.5 * 0.45)[..., None]
    rgb = rgb * (1 - core) + np.array(DEEP, np.float32) * core

    def up(a, b):
        im = Image.fromarray(a).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(b))
        return np.asarray(im, np.float32)

    rgb_f = up(np.clip(rgb, 0, 255).astype(np.uint8), 6)
    a_full = up((np.clip(alpha, 0, 1) * 255).astype(np.uint8), 10) / 255

    nr = np.random.default_rng(seed + 1000)
    dither = nr.normal(0, 1, (H, W)).astype(np.float32)
    a_d = np.clip(a_full + dither * 0.44 * np.sqrt(np.clip(a_full * (1 - a_full), 0, 1)), 0, 1)
    arr = 255 * (1 - a_d[..., None]) + rgb_f * a_d[..., None]
    g = nr.normal(0, 1, (H, W)).astype(np.float32)
    arr = arr + (g * (30 * np.clip(a_full * 1.5, 0, 1) + 4))[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def compose(name):
    return bloom(**COMPOSITIONS[name])


def sheet(path):
    names = [n for n in COMPOSITIONS if n != "onepager"]
    tiles = [compose(n).resize((640, 360)) for n in names]
    out = Image.new("RGB", (3 * 650 + 10, ((len(tiles) + 2) // 3) * 370 + 10), "#444")
    for i, t in enumerate(tiles):
        out.paste(t, (10 + (i % 3) * 650, 10 + (i // 3) * 370))
    out.save(path)
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet")
    ap.add_argument("--build", action="store_true")
    ap.add_argument("--only")
    a = ap.parse_args()
    if a.sheet:
        print(sheet(a.sheet))
    if a.build:
        os.makedirs(OUT, exist_ok=True)
        for n in COMPOSITIONS:
            if a.only and n not in a.only.split(","):
                continue
            p = os.path.join(OUT, f"{n}.jpg")
            compose(n).save(p, quality=88, optimize=True, progressive=True)
            print(p)
