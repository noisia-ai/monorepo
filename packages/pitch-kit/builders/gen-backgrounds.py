#!/usr/bin/env python3
"""
gen-backgrounds.py — per-slide background blobs, and the grain tile.

    python3 builders/gen-backgrounds.py <deck-dir> --slides 14
    python3 builders/gen-backgrounds.py <deck-dir> --spec my-spec.json
    python3 builders/gen-backgrounds.py <deck-dir> --slides 14 --grain

Writes `<deck-dir>/assets/bg-NN.png`, one per slide, and optionally `grain.png`.
Needs Pillow.

WHY THIS EXISTS. The engine paints one cyan blob in the same corner on every slide. Over a
14-slide deck that reads as a template. Giving each slide its own composition is what makes a
deck feel designed, and it was rebuilt by hand in the case this came from.

TWO THINGS IT GETS RIGHT, both learned the hard way:

  · The blobs are generated small (480x270) and heavily blurred, then stretched by CSS. They are
    already soft, so the stretch never shows, and each file weighs kilobytes instead of megabytes.
  · Grain is BAKED, never computed in the browser. An feTurbulence filter gets rasterised and
    rescaled by the print renderer, so it reads as cloud rather than grain, and it made one PDF
    jump from 8.5 MB to 19 MB. A 128x128 tile used at 1:1 puts one tile pixel on one canvas pixel,
    which is real grain. Better still, compose the grain into the blob asset itself.

HOW TO USE THE OUTPUT. Each slide carries `atmos plain` to switch off the engine's own blob, and
its background goes behind the frame:

    <section class="slide" data-label="…">
      <div class="atmos plain"></div>
      <img class="bg" src="assets/bg-04.png" alt="">
      <div class="frame">…</div>
    </section>

    .slide > .bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
                   z-index:0; pointer-events:none; }

A dark slide takes much higher alphas, so pass its number with --dark.
"""
import argparse, json, os, random
from PIL import Image, ImageDraw, ImageFilter

# On-palette, from engine/noisia-tokens.css. Slightly muted: these get composited at very low
# alpha and the raw token values read acid at large radii.
CYAN = (0, 205, 214)
RED = (232, 70, 58)
PALETTE = {"cyan": CYAN, "red": RED}

# Anchors walk around the edges so consecutive slides never repeat a corner. Values are
# fractions of the canvas; going slightly out of bounds is deliberate, it crops the blob.
ANCHORS = [(0.95, 0.06), (0.04, 0.92), (0.98, 0.68), (0.02, 0.16),
           (0.46, 1.04), (1.01, 0.30), (0.08, 0.04), (0.64, 1.02),
           (0.96, 0.94), (0.03, 0.52), (0.72, -0.04), (0.99, 0.50)]


def grain_tile(size=128, seed=20260915, clump=0.45):
    """Monochrome noise with no low-frequency structure, so the tile seam never shows."""
    rnd = random.Random(seed)
    fine = Image.new("L", (size, size))
    fine.putdata([rnd.randint(0, 255) for _ in range(size * size)])
    coarse = Image.new("L", (size // 2, size // 2))
    coarse.putdata([rnd.randint(0, 255) for _ in range((size // 2) ** 2)])
    coarse = coarse.resize((size, size), Image.BILINEAR)
    mixed = Image.blend(fine, coarse, clump)
    img = Image.new("RGBA", (size, size))
    src, dst = mixed.load(), img.load()
    for y in range(size):
        for x in range(size):
            # neutral grey at varying alpha: works on light, and inverted on dark
            dst[x, y] = (0, 0, 0, abs(src[x, y] - 128) * 2)
    return img


def blob_bg(spec, w=480, h=270, blur=52):
    """spec: list of (cx, cy, r, colour-name, alpha), coordinates as 0..1 fractions."""
    img = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    for cx, cy, r, colour, alpha in spec:
        rgb = PALETTE[colour] if isinstance(colour, str) else tuple(colour)
        layer = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        rx, ry = r * w, r * w * 0.78
        x, y = cx * w, cy * h
        ImageDraw.Draw(layer).ellipse([x - rx, y - ry, x + rx, y + ry], fill=rgb + (alpha,))
        img = Image.alpha_composite(img, layer.filter(ImageFilter.GaussianBlur(blur)))
    return img.filter(ImageFilter.GaussianBlur(blur * 0.35))


def default_spec(n_slides, dark=(), seed=20260915):
    """A composition per slide: one large blob plus a small counterweight of the other colour.

    Alphas stay low on purpose. The background accompanies the content, it never competes with
    it. On a slide whose content is the protagonist (a map, a matrix) drop it further by hand."""
    rnd = random.Random(seed)
    out = {}
    for i, n in enumerate(range(2, n_slides + 1)):   # slide 1 is the cover, it carries its own art
        cx, cy = ANCHORS[i % len(ANCHORS)]
        ox, oy = ANCHORS[(i + 5) % len(ANCHORS)]
        big, small = ("cyan", "red") if i % 3 else ("red", "cyan")
        if n in dark:
            out[n] = [(cx, cy, round(rnd.uniform(0.38, 0.52), 2), big, rnd.randint(70, 78)),
                      (ox, oy, round(rnd.uniform(0.26, 0.34), 2), small, rnd.randint(40, 46))]
        else:
            out[n] = [(cx, cy, round(rnd.uniform(0.32, 0.46), 2), big, rnd.randint(16, 26)),
                      (ox, oy, round(rnd.uniform(0.16, 0.26), 2), small, rnd.randint(8, 14))]
    return out


def main():
    ap = argparse.ArgumentParser(description="Per-slide background blobs for a Noisia deck.")
    ap.add_argument("deck")
    ap.add_argument("--slides", type=int, help="total slides; generates 2..N")
    ap.add_argument("--spec", help="JSON file: {\"4\": [[cx,cy,r,\"cyan\",22], …]}")
    ap.add_argument("--dark", default="", help="comma-separated slide numbers that are .slide.dark")
    ap.add_argument("--grain", action="store_true", help="also write assets/grain.png")
    ap.add_argument("--seed", type=int, default=20260915)
    a = ap.parse_args()

    out = os.path.join(os.path.abspath(a.deck), "assets")
    os.makedirs(out, exist_ok=True)

    if a.spec:
        spec_set = {int(k): [tuple(b) for b in v] for k, v in json.load(open(a.spec)).items()}
    elif a.slides:
        dark = {int(x) for x in a.dark.split(",") if x.strip()}
        spec_set = default_spec(a.slides, dark, a.seed)
    else:
        ap.error("pass --slides N or --spec file.json")

    total = 0
    for n, spec in sorted(spec_set.items()):
        path = os.path.join(out, f"bg-{n:02d}.png")
        blob_bg(spec).save(path, optimize=True)
        total += os.path.getsize(path)
    print(f"{len(spec_set)} fondos en {out}, {total/1024:.0f} KB en total")

    if a.grain:
        g = os.path.join(out, "grain.png")
        grain_tile(seed=a.seed).save(g, optimize=True)
        print(f"grain.png: tile de 128x128, úsalo a 1:1 con background-size:128px 128px. "
              f"Sobre fondo oscuro va invertido con filter:invert(1).")


if __name__ == "__main__":
    main()
