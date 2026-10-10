#!/usr/bin/env python3
"""
make_assets.py — render the PNG assets the commercial PPTX builder places on slides.

    python3 commercial/builder/make_assets.py --iconoir <dir> --simple-icons <dir>

Runs once, locally, on a machine with Chrome and Pillow. Its output is committed under
commercial/assets/ and travels inside the claude.ai skill, so nobody downstream needs Chrome,
npm or network access.

WHY PNG. Google Slides does not import SVG from a PPTX and LibreOffice renders it unevenly. A
PNG at 128px, placed at 22 to 44px, stays sharp in both and weighs a few KB. Every glyph still
comes from Iconoir (semantic) or Simple Icons (brands), as ICONS.md requires; this script only
rasterises them.

  --iconoir       <node_modules/iconoir/icons/regular>
  --simple-icons  <node_modules/simple-icons/icons>
"""
import argparse, json, os, re, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(KIT, "commercial", "assets")
CHROME = os.environ.get("CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

# Tones from engine/noisia-tokens.css and deck-components.css.
TONES = {"teal": "#008a8a", "coral": "#e2543c", "ink": "#2b2b2b", "grey": "#999999", "white": "#ffffff"}

# The semantic set the commercial slides use. Extend here, re-run, commit.
ICONS = """search chat-bubble chat-lines graph-up eye brain light-bulb megaphone group community
calendar clock timer check-circle xmark-circle arrow-right rocket map path-arrow reports page-search
database filter flash star shop wallet hand-cash medal compass position presentation stats-report
globe sparks refresh-double bell-notification mail phone headset lock heart thumbs-up crown puzzle
journal-page multiple-pages send download link building truck car health-shield home-simple
suitcase percentage coins piggy-bank warning-triangle priority-high clipboard-check design-pencil
cpu network question-mark help-circle hand-card ruler cube box-iso sound-high trophy dollar-circle
tv user-crown user-badge-check open-book shield-check data-transfer-both activity infinite repeat
calendar-plus cart airplane leaf droplet pizza-slice glass-half cinema-old gamepad soccer-ball
hospital bank home city industry wifi sofa shirt apple-half plus minus nav-arrow-right
arrow-up-right play""".split()

# Brand marks: Simple Icons slug -> brand colour. Missing slugs are skipped with a warning.
BRANDS = {"x": "#000000", "facebook": "#0866FF", "instagram": "#E4405F", "tiktok": "#000000",
          "youtube": "#FF0000", "reddit": "#FF4500", "google": "#4285F4", "trustpilot": "#00B67A",
          "tripadvisor": "#34E0A1", "googlemaps": "#4285F4", "appstore": "#0D96F6",
          "googleplay": "#414141", "perplexity": "#1FB8CD", "googlegemini": "#8E75B2",
          "spotify": "#1ED760", "twitch": "#9146FF", "whatsapp": "#25D366", "telegram": "#26A5E4",
          "threads": "#000000", "pinterest": "#BD081C", "discord": "#5865F2", "quora": "#B92B27",
          "yelp": "#FF1A1A"}

CELL = 128


def chrome_sheet(svgs, color, path, cols=12):
    """One HTML page, one transparent screenshot, then crop: far faster than a render per icon."""
    rows = (len(svgs) + cols - 1) // cols
    cells = "".join(f'<div class="c">{s}</div>' for s in svgs)
    html = f"""<!doctype html><html><head><style>
      html,body{{margin:0;background:transparent}}
      .g{{display:grid;grid-template-columns:repeat({cols},{CELL}px);grid-auto-rows:{CELL}px}}
      .c{{display:flex;align-items:center;justify-content:center;color:{color}}}
      .c svg{{width:{CELL-16}px;height:{CELL-16}px}}
    </style></head><body><div class="g">{cells}</div></body></html>"""
    with tempfile.TemporaryDirectory() as td:
        f = os.path.join(td, "s.html")
        open(f, "w").write(html)
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--force-device-scale-factor=1", "--default-background-color=00000000",
                        f"--window-size={cols*CELL},{rows*CELL}", f"--screenshot={path}",
                        f"file://{f}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return Image.open(path).convert("RGBA"), cols


def crop_all(sheet, cols, names, outdir, suffix):
    os.makedirs(outdir, exist_ok=True)
    for i, n in enumerate(names):
        r, c = divmod(i, cols)
        tile = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
        tile.save(os.path.join(outdir, f"{n}{suffix}.png"), optimize=True)


def iconoir_svg(path, stroke=1.6):
    s = open(path).read()
    s = re.sub(r'stroke-width="[^"]*"', "", s)
    return s.replace("<svg ", f'<svg stroke-width="{stroke}" ', 1)


def icons(iconoir_dir):
    names = [n for n in ICONS if os.path.exists(os.path.join(iconoir_dir, f"{n}.svg"))]
    missing = sorted(set(ICONS) - set(names))
    if missing:
        print("iconoir sin estos nombres:", " ".join(missing))
    svgs = [iconoir_svg(os.path.join(iconoir_dir, f"{n}.svg")) for n in names]
    with tempfile.TemporaryDirectory() as td:
        for tone, hexv in TONES.items():
            sheet, cols = chrome_sheet(svgs, hexv, os.path.join(td, f"{tone}.png"))
            crop_all(sheet, cols, names, os.path.join(OUT, "icons"), f"-{tone}")
    print(f"{len(names)} íconos × {len(TONES)} tonos")
    return names


def brands(si_dir):
    names, glyphs = [], []
    for slug in BRANDS:
        p = os.path.join(si_dir, f"{slug}.svg")
        if not os.path.exists(p):
            print("simple-icons sin", slug)
            continue
        d = re.search(r'<path d="([^"]+)"', open(p).read()).group(1)
        names.append(slug)
        glyphs.append(d)
    with tempfile.TemporaryDirectory() as td:
        # brand-coloured glyph on transparent
        for i, (slug, d) in enumerate(zip(names, glyphs)):
            pass
        coloured = [f'<svg viewBox="0 0 24 24"><path fill="{BRANDS[s]}" d="{d}"/></svg>'
                    for s, d in zip(names, glyphs)]
        sheet, cols = chrome_sheet(coloured, "#000", os.path.join(td, "b.png"))
        crop_all(sheet, cols, names, os.path.join(OUT, "brands"), "")
        # white glyph, to sit on a brand-coloured chip drawn as a PPTX shape (stays editable)
        white = [f'<svg viewBox="0 0 24 24"><path fill="#ffffff" d="{d}"/></svg>' for d in glyphs]
        sheet, cols = chrome_sheet(white, "#fff", os.path.join(td, "w.png"))
        crop_all(sheet, cols, names, os.path.join(OUT, "brands"), "-white")
    json.dump(BRANDS, open(os.path.join(OUT, "brands", "colors.json"), "w"), indent=1)
    print(f"{len(names)} marcas")


def logos():
    """The wordmark at 4x its 30px slide height, in ink and in white. The white one keeps the
    cyan and red layers: the engine's invert() swaps their sides, which the brand does not."""
    src = open(os.path.join(KIT, "assets", "logo_norm.svg")).read()
    variants = {"noisia": src, "noisia-white": re.sub(r'#000200', '#ffffff', src, flags=re.I)}
    os.makedirs(os.path.join(OUT, "logo"), exist_ok=True)
    m = re.search(r'viewBox="([\d.\s-]+)"', src)
    vw, vh = [float(x) for x in m.group(1).split()[2:4]]
    h = 120
    w = int(round(h * vw / vh))
    for name, svg in variants.items():
        svg = re.sub(r'<svg\b', f'<svg style="width:{w}px;height:{h}px;display:block"', svg, count=1)
        with tempfile.TemporaryDirectory() as td:
            f = os.path.join(td, "l.html")
            open(f, "w").write(f"<html><body style='margin:0;background:transparent'>{svg}</body></html>")
            png = os.path.join(OUT, "logo", f"{name}.png")
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            "--force-device-scale-factor=1", "--default-background-color=00000000",
                            f"--window-size={w},{h}", f"--screenshot={png}", f"file://{f}"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    print("logos", w, "x", h)


def blob(spec, size=(960, 540), base=(255, 255, 255)):
    """Same recipe as builders/gen-backgrounds.py: small, heavily blurred, stretched by the
    slide. Cyan and red from the engine, alphas low so the content always wins."""
    w, h = size
    im = Image.new("RGB", size, base)
    for cx, cy, r, rgb, a in spec:
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        R = r * w
        d.ellipse([cx * w - R, cy * h - R * 0.8, cx * w + R, cy * h + R * 0.8], fill=rgb + (a,))
        layer = layer.filter(ImageFilter.GaussianBlur(w * 0.11)).filter(ImageFilter.GaussianBlur(w * 0.04))
        im.paste(layer, (0, 0), layer)
    return im


def backgrounds():
    cy, rd, dark = (0, 205, 214), (232, 70, 58), (6, 18, 24)
    out = os.path.join(OUT, "bg")
    os.makedirs(out, exist_ok=True)
    # Content: one composition per slide, rotating corners (LAYOUTS.md, Backgrounds).
    content = [
        [(0.97, 0.05, 0.40, cy, 26), (0.05, 0.98, 0.20, rd, 12)],
        [(0.03, 0.95, 0.42, cy, 24), (0.98, 0.10, 0.18, rd, 10)],
        [(1.00, 0.70, 0.38, cy, 24), (0.10, 0.02, 0.18, rd, 10)],
        [(0.02, 0.12, 0.40, cy, 22), (0.92, 0.98, 0.20, rd, 12)],
        [(0.50, 1.06, 0.44, cy, 22), (1.00, 0.05, 0.16, rd, 10)],
        [(0.98, 0.95, 0.36, rd, 16), (0.02, 0.05, 0.24, cy, 18)],
        [(0.70, -0.05, 0.40, cy, 22), (0.02, 0.85, 0.18, rd, 10)],
        [(0.03, 0.50, 0.36, cy, 20), (1.00, 0.40, 0.20, rd, 12)],
    ]
    for i, spec in enumerate(content, 1):
        blob(spec).save(os.path.join(out, f"content-{i:02d}.png"), optimize=True)
    # Dark statement: the "answer" slide of the canon, #061218 with cyan and red at ~30%.
    blob([(0.10, 0.98, 0.46, cy, 74), (0.95, 0.05, 0.30, rd, 44)], base=dark).save(
        os.path.join(out, "dark-01.png"), optimize=True)
    blob([(0.95, 0.95, 0.44, cy, 70), (0.05, 0.08, 0.28, rd, 40)], base=dark).save(
        os.path.join(out, "dark-02.png"), optimize=True)
    # Bold art from the website, for cover, statements and closing.
    ref = os.path.join(KIT, "..", "..", "apps", "website", "assets", "background-reference")
    for src, dst in (("Slide 16_9 - 26.png", "bold-right.jpg"), ("Slide 16_9 - 2.png", "bold-corner.jpg"),
                     ("Slide 16_9 - 5.png", "bold-left.jpg"), ("Slide 16_9 - 8.png", "bold-center.jpg"),
                     ("Slide 16_9 - 9.png", "bold-scatter.jpg")):
        p = os.path.join(ref, src)
        if os.path.exists(p):
            Image.open(p).convert("RGB").resize((1920, 1080), Image.LANCZOS).save(
                os.path.join(out, dst), quality=84, optimize=True)
    print("fondos listos")


def art():
    out = os.path.join(OUT, "art")
    os.makedirs(out, exist_ok=True)
    im = Image.open(os.path.join(KIT, "assets", "cover-illustration.png")).convert("RGBA")
    im.thumbnail((1400, 1400), Image.LANCZOS)
    im.save(os.path.join(out, "cover-illustration.png"), optimize=True)
    # Client-logo slot: a dashed box people replace in Google Slides (right click > Replace image).
    for lang, label in (("es", "Logo del cliente"), ("en", "Client logo")):
        w, h = 560, 200
        slot = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(slot)
        for x in range(0, w, 22):
            d.line([(x, 1), (min(x + 12, w), 1)], fill=(153, 153, 153, 255), width=3)
            d.line([(x, h - 2), (min(x + 12, w), h - 2)], fill=(153, 153, 153, 255), width=3)
        for y in range(0, h, 22):
            d.line([(1, y), (1, min(y + 12, h))], fill=(153, 153, 153, 255), width=3)
            d.line([(w - 2, y), (w - 2, min(y + 12, h))], fill=(153, 153, 153, 255), width=3)
        slot.save(os.path.join(out, f"client-logo-slot-{lang}.png"), optimize=True)
    print("arte listo")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--iconoir", required=True)
    ap.add_argument("--simple-icons", required=True)
    ap.add_argument("--only", default="", help="icons,brands,logos,bg,art")
    a = ap.parse_args()
    only = set(a.only.split(",")) if a.only else {"icons", "brands", "logos", "bg", "art"}
    if "icons" in only: icons(a.iconoir)
    if "brands" in only: brands(a.simple_icons)
    if "logos" in only: logos()
    if "bg" in only: backgrounds()
    if "art" in only: art()
