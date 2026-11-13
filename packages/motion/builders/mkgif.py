#!/usr/bin/env python3
"""
mkgif.py: a PNG sequence into a light GIF for a slide (VIDEO.md §5.4, COMMERCIAL.md §9).

    python3 builders/mkgif.py <png folder> <out.gif>      env: COLORS (64), LOSSY (30), FPS (15)

One fixed palette for every frame, no dithering (dithering changes every pixel between frames and
makes the GIF five times heavier), and an exact numpy mapping: Pillow's quantize sends #ffffff to
(252, 252, 252), which shows as a grey box on a white slide. Then gifsicle -O3 --lossy.
"""
import glob, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
frames = sorted(glob.glob(os.path.join(src, "*.png")))
if not frames:
    raise SystemExit(f"no PNG frames in {src}")
ims = [Image.open(f).convert("RGB") for f in frames]
W, H = ims[0].size

sample = ims[:: max(1, len(ims) // 8)]
strip = Image.new("RGB", (W, H * len(sample)))
for k, im in enumerate(sample):
    strip.paste(im, (0, H * k))
pal_img = strip.quantize(colors=int(os.environ.get("COLORS", 64)), method=Image.Quantize.MEDIANCUT)
p = pal_img.getpalette()[:768]
n = len(p) // 3
white = min(range(n), key=lambda i: sum((255 - v) ** 2 for v in p[3 * i: 3 * i + 3]))
p[3 * white: 3 * white + 3] = [255, 255, 255]        # the slide is exact white
PAL = np.array(p, dtype=np.int32).reshape(-1, 3)


def exact(im):
    a = np.asarray(im, dtype=np.int32)
    flat = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
    u, inv = np.unique(flat, return_inverse=True)
    rgb = np.stack([(u >> 16) & 255, (u >> 8) & 255, u & 255], 1)
    d = ((rgb[:, None, :] - PAL[None, :, :]) ** 2).sum(2)
    idx = d.argmin(1).astype(np.uint8)[inv.reshape(-1)].reshape(a.shape[:2])
    o = Image.frombytes("P", (idx.shape[1], idx.shape[0]), idx.astype(np.uint8).tobytes())
    o.putpalette(p)
    return o


q = [exact(im) for im in ims]
raw = out + ".raw.gif"
q[0].save(raw, save_all=True, append_images=q[1:], duration=int(1000 / int(os.environ.get("FPS", 15))), loop=0, optimize=False, disposal=1)
if shutil.which("gifsicle"):
    subprocess.run(["gifsicle", "-O3", f"--lossy={os.environ.get('LOSSY', '30')}", raw, "-o", out], check=True)
    os.remove(raw)
else:
    os.replace(raw, out)
    print("gifsicle not found (brew install gifsicle): GIF left unoptimised")
first = np.asarray(Image.open(out).convert("RGB"))
corner = tuple(first[2, 2])
print(f"{out} · {os.path.getsize(out) / 1e6:.2f} MB · {W}×{H} · {len(ims)} frames · corner pixel {tuple(int(c) for c in corner)}")
if corner != (255, 255, 255):
    print("WARNING: the corner is not exact white; it will show as a box on the slide")
