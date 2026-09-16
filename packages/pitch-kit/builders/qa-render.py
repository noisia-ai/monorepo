#!/usr/bin/env python3
"""
qa-render.py — render every slide at 1920x1080, flag possible overflow, and build contact
sheets so a deck gets reviewed in blocks instead of one slide at a time.

    python3 builders/qa-render.py <deck-dir> <total-slides> [--force]

CANON.md says every slide gets rendered and looked at before a deck is called done. This is
the tool for it. In the case that produced it, it caught three defects that would have
shipped: real overflow onto the footer, KPI cards left transparent over the background blob,
and chips that contradicted their own slide title.

The overflow check is a heuristic: dense ink in the top or bottom 18px band of the canvas
means something escaped its container. It tells you where to look, it does not decide.
Needs Pillow (`pip install pillow`) and Chrome.
"""
import json, os, subprocess, sys
from PIL import Image

CHROME = os.environ.get(
    "CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
BAND = 18          # alto de la banda que se inspecciona, arriba y abajo
DARK = 120         # umbral de luminancia para contar un pixel como tinta
LIMIT = 400        # pixeles de tinta en la banda a partir de los cuales se marca la slide


def render(deck, n, out, force=False):
    png = os.path.join(out, f"slide-{n:02d}.png")
    if os.path.exists(png) and not force:
        return png
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=1920,1080",
                    f"--screenshot={png}",
                    f"file://{os.path.join(deck, 'index.html')}#{n}"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return png


def edge_ink(png):
    im = Image.open(png).convert("L")
    w, h = im.size
    out = {}
    for name, box in (("top", (0, 0, w, BAND)), ("bottom", (0, h - BAND, w, h))):
        out[name] = sum(1 for p in im.crop(box).getdata() if p < DARK)
    return out


def sheet(pngs, path, cols=2):
    ims = [Image.open(p).resize((960, 540), Image.LANCZOS) for p in pngs]
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new("RGB", (cols * 960 + (cols + 1) * 10, rows * 540 + (rows + 1) * 10), "#3a3a3a")
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        sh.paste(im, (10 + c * 970, 10 + r * 550))
    sh.save(path)
    return path


def main():
    if len(sys.argv) < 3:
        sys.exit("uso: python3 builders/qa-render.py <deck-dir> <total-slides> [--force]")
    deck = os.path.abspath(sys.argv[1])
    total = int(sys.argv[2])
    force = "--force" in sys.argv
    out = os.path.join(deck, "work", "renders")
    os.makedirs(out, exist_ok=True)

    flagged, pngs = {}, []
    for n in range(1, total + 1):
        p = render(deck, n, out, force)
        pngs.append(p)
        ink = edge_ink(p)
        if ink["top"] > LIMIT or ink["bottom"] > LIMIT:
            flagged[n] = ink
        print(f"\rrenderizadas {n}/{total}", end="", flush=True)
    print()

    sheets = [sheet(pngs[i:i + 4], os.path.join(out, f"hoja-{i // 4 + 1}.png"))
              for i in range(0, len(pngs), 4)]
    print(json.dumps({"deck": os.path.basename(deck), "slides": total,
                      "posible_desborde": flagged, "hojas": sheets},
                     ensure_ascii=False, indent=2))
    if flagged:
        print("\nRevisa esas slides a tamaño real antes de exportar.")


if __name__ == "__main__":
    main()
