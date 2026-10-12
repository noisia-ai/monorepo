#!/usr/bin/env python3
"""
make_shapes.py — the Noisia shape family for commercial decks, rendered by code.

    python3 commercial/builder/make_shapes.py --sheet out.png       # the family, to choose
    python3 commercial/builder/make_shapes.py --build                # writes assets/shapes/*.png

The shapes replace the people illustration on covers and closings, and appear as a faint
fragment on content slides. They follow the method of the brand's Figma explorations:

  · an organic closed path (a smooth spline through hand-placed points, never random);
  · a linear gradient fill, cyan to deep teal to charcoal;
  · three inner shadows: cyan #95E6F1 at 40% from the top (y +66, blur 24), and red #FF464C
    (y -106, blur 30) plus #C7313D (y -116, blur 64) from the bottom, which give the red rim;
  · a layer blur of 64;
  · duo noise on top: black and white at 25%, 90% density, 1.5px grain.

Everything is measured on the 1920x1080 slide, so a shape drawn at slide size here looks the
same as in Figma. Output is RGBA PNG, composed later on white by the builder.
"""
import argparse, math, os, warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "shapes"))

# Points are fractions of the shape's own box, clockwise. Drawn to match the explorations.
SHAPES = {
    "crescent": [(0.30, 0.02), (0.42, 0.08), (0.48, 0.30), (0.58, 0.55), (0.75, 0.68), (0.95, 0.72),
                 (1.00, 0.84), (0.88, 0.97), (0.55, 1.00), (0.25, 0.95), (0.05, 0.78), (0.00, 0.45),
                 (0.10, 0.15)],
    "wing": [(0.02, 0.06), (0.16, 0.00), (0.40, 0.05), (0.66, 0.26), (0.92, 0.56), (1.00, 0.82),
             (0.92, 0.97), (0.78, 0.86), (0.55, 0.73), (0.30, 0.76), (0.10, 0.70), (0.05, 0.55),
             (0.12, 0.40), (0.00, 0.22)],
    "drop": [(0.55, 0.00), (0.85, 0.10), (1.00, 0.45), (0.85, 0.85), (0.45, 1.00), (0.10, 0.90),
             (0.00, 0.70), (0.20, 0.40)],
    "star": [(0.00, 0.44), (0.14, 0.32), (0.36, 0.30), (0.47, 0.12), (0.56, 0.02), (0.65, 0.14),
             (0.72, 0.30), (0.90, 0.34), (1.00, 0.60), (0.86, 0.90), (0.45, 1.00), (0.20, 0.93),
             (0.07, 0.76)],
    "drip": [(0.00, 0.00), (1.00, 0.00), (1.00, 0.12), (0.76, 0.30), (0.59, 0.42), (0.545, 0.64),
             (0.52, 0.78), (0.495, 0.64), (0.46, 0.42), (0.30, 0.33), (0.04, 0.30)],
    "pebble": [(0.20, 0.05), (0.60, 0.00), (0.92, 0.18), (1.00, 0.55), (0.80, 0.92), (0.40, 1.00),
               (0.08, 0.82), (0.00, 0.40)],
}

STOPS = [(0.0, (124, 214, 221)), (0.42, (62, 128, 144)), (0.78, (43, 59, 76)), (1.0, (42, 39, 51))]
SHADOWS = [  # colour, alpha, dx, dy, blur
    ((149, 230, 241), 0.40, 3, 66, 24),
    ((255, 70, 76), 0.90, 0, -106, 30),
    ((199, 49, 61), 0.85, 0, -116, 64),
]
LAYER_BLUR = 64


def catmull(points, n=40):
    pts = points + points[:3]
    out = []
    for i in range(len(points)):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    return out


def blur(a, sigma):
    """Gaussian blur of a float array through PIL (sigma in px)."""
    if sigma <= 0:
        return a
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), "L")
    return np.asarray(im.filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32) / 255


def shift(a, dx, dy):
    out = np.zeros_like(a)
    h, w = a.shape
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    out[yd, xd] = a[ys, xs]
    return out


def render(name, w, h, angle=200, seed=7):
    """One shape, w x h px at slide scale, as an RGBA image with room for its blur."""
    pad = int(LAYER_BLUR * 1.6)
    W, H = w + 2 * pad, h + 2 * pad
    ss = 2
    big = Image.new("L", (W * ss, H * ss), 0)
    pts = [((pad + x * w) * ss, (pad + y * h) * ss) for x, y in catmull(SHAPES[name])]
    ImageDraw.Draw(big).polygon(pts, fill=255)
    mask = np.asarray(big.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255

    # linear gradient across the shape's box
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    a = math.radians(angle)
    proj = (xx - W / 2) * math.cos(a) + (yy - H / 2) * math.sin(a)
    span = abs(w * math.cos(a)) + abs(h * math.sin(a))
    t = np.clip(proj / span + 0.5, 0, 1)
    rgb = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        rgb[..., c] = np.interp(t, [s[0] for s in STOPS], [s[1][c] for s in STOPS])

    # inner shadows: where the shifted shape does not cover, inside the shape
    k = h / 730   # the Figma values were set on a shape about 730px tall; scale them with the shape
    for col, op, dx, dy, b in SHADOWS:
        outside = 1 - shift(mask, int(round(dx * k)), int(round(dy * k)))
        sh = blur(outside, b * 0.8 * max(k, 0.4)) * mask * op
        for c in range(3):
            rgb[..., c] = rgb[..., c] * (1 - sh) + col[c] * sh

    # layer blur on premultiplied colour
    alpha = mask
    pre = rgb * alpha[..., None]
    sig = LAYER_BLUR / 4   # Figma's blur value reads as roughly 4x a gaussian sigma
    pre = np.stack([blur(pre[..., c] / 255, sig) * 255 for c in range(3)], -1)
    alpha = blur(alpha, sig)
    rgb = np.where(alpha[..., None] > 1e-4, pre / np.maximum(alpha[..., None], 1e-4), 0)

    # duo noise, 1.5px grain, 90% density, black and white at 25%
    rnd = np.random.default_rng(seed)
    gw, gh = W, H
    g = rnd.random((gh, gw))
    d = rnd.random((gh, gw)) < 0.9
    grain = np.where(d, np.where(g < 0.5, -1.0, 1.0), 0.0).astype(np.float32)
    grain = np.asarray(Image.fromarray(((grain + 1) * 127.5).astype(np.uint8)).resize((W, H), Image.NEAREST),
                       dtype=np.float32) / 127.5 - 1
    k = 0.085 * 255 * grain[..., None] * np.clip(alpha[..., None] * 1.6, 0, 1)
    rgb = np.clip(rgb + np.where(k > 0, k * (1 - rgb / 255), k * (rgb / 255)), 0, 255)

    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out), pad


def place(canvas, name, box, rot=0, flip=False, opacity=1.0, angle=200, seed=7):
    """Render `name` to fit box=(x, y, w, h) on the slide, rotate, and alpha-composite it."""
    x, y, w, h = box
    im, pad = render(name, w, h, angle, seed)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    if opacity < 1:
        r, g, b, a = im.split()
        im = Image.merge("RGBA", (r, g, b, a.point(lambda v: int(v * opacity))))
    cx, cy = x + w / 2, y + h / 2
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2))) if \
        cx - im.width / 2 >= 0 and cy - im.height / 2 >= 0 else _paste(canvas, im, cx - im.width / 2, cy - im.height / 2)


def _paste(canvas, im, x, y):
    x, y = int(x), int(y)
    sx, sy = max(0, -x), max(0, -y)
    crop = im.crop((sx, sy, min(im.width, canvas.width - x), min(im.height, canvas.height - y)))
    canvas.alpha_composite(crop, (max(0, x), max(0, y)))


# Compositions on the 1920x1080 slide. Covers keep the left 1000px clean for the copy.
COMPOSITIONS = {
    "cover": [("crescent", (1090, 320, 440, 600), -18, False, 1.0, 200, 1),
              ("drop", (1480, 690, 160, 140), 0, False, 1.0, 210, 2),
              ("wing", (1490, 130, 540, 470), 0, False, 1.0, 215, 3)],
    "closing": [("star", (1060, 260, 860, 640), -8, False, 1.0, 205, 4),
                ("drop", (1640, 860, 150, 130), 20, False, 1.0, 210, 5)],
    "statement": [("drip", (700, -40, 1300, 560), 0, False, 1.0, 190, 6)],
    # content fragments: one per slide, rotating corners, faint
    # Content fragments sit on the middle of an edge: every corner carries chrome (logo,
    # noisia.ai, the tagline, the slide number) and a shape behind it hurts legibility.
    "frag-1": [("wing", (1700, 300, 560, 480), 0, False, 0.36, 215, 11)],
    "frag-2": [("crescent", (820, 900, 420, 520), 80, False, 0.34, 200, 12)],
    "frag-3": [("pebble", (-300, 420, 460, 400), 0, False, 0.34, 205, 13)],
    "frag-4": [("star", (1720, 560, 520, 430), -24, False, 0.34, 205, 14)],
    "frag-5": [("wing", (1040, 930, 520, 420), 180, False, 0.32, 215, 15)],
    "frag-6": [("crescent", (-260, 300, 420, 520), 200, True, 0.34, 200, 16)],
    # A4 one-pager (1191 x 1684): one shape bleeding off the lower right, clear of the logo slot
    "onepager": [("wing", (930, 1360, 520, 440), 180, False, 0.30, 215, 21)],
}


SIZES = {"onepager": (1191, 1684)}


def compose(name, base=(255, 255, 255, 255)):
    c = Image.new("RGBA", SIZES.get(name, (1920, 1080)), base)
    for shp, box, rot, flip, op, ang, seed in COMPOSITIONS[name]:
        place(c, shp, box, rot, flip, op, ang, seed)
    return c


def sheet(path):
    tiles = []
    for name in SHAPES:
        c = Image.new("RGBA", (900, 700), (255, 255, 255, 255))
        im, pad = render(name, 560, 460 if name != "drip" else 300)
        c.alpha_composite(im, ((900 - im.width) // 2, (700 - im.height) // 2))
        tiles.append(c)
    W = 3 * 900
    out = Image.new("RGB", (W, 2 * 700), "white")
    for i, t in enumerate(tiles):
        out.paste(t.convert("RGB"), ((i % 3) * 900, (i // 3) * 700))
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
            p = os.path.join(OUT, f"{n}.jpg")   # opaque on white; JPEG keeps the grain at a fifth of the weight
            compose(n).convert("RGB").save(p, quality=86, optimize=True, progressive=True)
            print(p)
