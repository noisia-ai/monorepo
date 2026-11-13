#!/usr/bin/env python3
"""
build.py: a credentials deck from one content JSON (COMMERCIAL.md §2.1).

    python3 build.py examples/portfolio.en.json --out ~/Downloads/<Lead>/credenciales/deck
    python3 build.py ... --pptx      # also GIFs (capture_gifs.py) and the editable PPTX (build_pptx.py)

Writes <out>/index.html with deck-stage.js and assets/ next to it. Serve <out> and present from the
browser: each animation plays once when its slide comes in, and printing (Chrome, PDF) shows every
diagram finished. The same JSON feeds build_pptx.py, so the copy lives in one place.

Slide types: cover, pillars, ways, compare, case (with an optional closing band), menu, coverage.
The fields of each are in examples/ and in COMMERCIAL.md §2.1.
"""
import argparse, html, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
COMM = os.path.dirname(HERE)
KIT = os.path.dirname(COMM)
A = os.path.join(COMM, "assets")
ASSETS = {  # published name -> kit file
    "noisia.png": f"{A}/logo/noisia.png",
    "sprite-teal.png": f"{A}/icons/sprite-teal.png", "sprite-grey.png": f"{A}/icons/sprite-grey.png",
    "sprite-coral.png": f"{A}/icons/sprite-coral.png", "sprite-ink.png": f"{A}/icons/sprite-ink.png",
    "brands-white.png": f"{A}/brands/sprite-white.png",
    **{f"cover-{i}.jpg": f"{A}/shapes/cover-{i}.jpg" for i in range(1, 7)},
    **{f"closing-{i}.jpg": f"{A}/shapes/closing-{i}.jpg" for i in range(1, 7)},
    **{f"frag-{i}.jpg": f"{A}/shapes/frag-{i}.jpg" for i in range(1, 7)},
    **{f"GoogleSans-{w}.ttf": f"{COMM}/fonts/GoogleSans-{w}.ttf" for w in ("Regular", "Medium", "Bold")},
}
UI = {
    "es": {"gets": "Qué recibes", "illus": "Ilustrativo"},
    "en": {"gets": "What you get", "illus": "Illustrative"},
}
EXTRA_CSS = """
/* compare */
.cmp h2{position:absolute;left:120px;top:150px;font-size:60px;font-weight:700;color:var(--ink);letter-spacing:-.01em}
.cmp .lead{position:absolute;left:120px;top:248px;width:1400px;font-size:27px;line-height:1.4;color:var(--fg2)}
.cmp svg{position:absolute;left:120px;top:340px}
"""


def esc(s):
    """Escape, then **x** becomes the teal word (one per title)."""
    return re.sub(r"\*\*(.+?)\*\*", r'<span class="t">\1</span>', html.escape(s or "", quote=False))


def ico(name, tone=None, cls="ico"):
    t = f' data-t="{tone}"' if tone else ""
    return f'<i class="{cls}" data-i="{name}"{t}></i>'


def svg(anim, w, h, labels=None, extra=""):
    lab = f" data-labels='{html.escape(json.dumps(labels, ensure_ascii=False), quote=True)}'" if labels else ""
    return f'<svg data-anim="{anim}" width="{w}" height="{h}" viewBox="0 0 {w} {h}"{lab}{extra}></svg>'


def frame(n):
    return f'<span class="foot l">noisia.ai</span><span class="foot r">{n:02d}</span>'


LOGO = '<img class="logo" src="assets/noisia.png" alt="Noisia">'


def cover(d, n, ui):
    return (f'<section class="cover bg" data-label="{html.escape(d.get("label", "Cover"))}" style="background-image:url(assets/{d.get("bg", "cover-2.jpg")})">'
            f'{LOGO}<h1>{esc(d["title"])}</h1><p class="sub">{esc(d.get("sub", ""))}</p><p class="date">{esc(d.get("date", ""))}</p></section>')


def pillars(d, n, ui):
    icons = any(p.get("icon") for p in d["pillars"])
    def mark(i, p):
        return ico(p["icon"]) if icons else f'<span class="num">{i + 1}</span>'
    ps = "".join(f'<div class="pillar"><div class="n">{mark(i, p)}{esc(p["title"])}</div><p>{esc(p["text"])}</p></div>'
                 for i, p in enumerate(d["pillars"]))
    return (f'<section class="s2{" s3p" if icons else ""}" data-label="{html.escape(d.get("label", d["title"]))}">{LOGO}'
            f'<h2>{esc(d["title"])}</h2><p class="lead">{esc(d["lead"])}</p>{svg(d["anim"], 1680, 400, d.get("labels"))}'
            f'<div class="pillars">{ps}</div>{frame(n)}</section>')


def ways(d, n, ui):
    cols = "".join(
        f'<div class="col card"><div class="hd"><span class="icobox">{ico(c["icon"])}</span><h3>{esc(c["name"])}</h3></div>'
        f'<p class="lead">{esc(c["lead"])}</p><ul>{"".join(f"<li>{esc(q)}</li>" for q in c["questions"])}</ul>'
        + '<div class="tags">' + "".join(f'<span class="chip g">{esc(t)}</span>' for t in c["chips"]) + '</div></div>'
        for c in d["cols"])
    src = "".join(f'<div>{ico(s["icon"])}<div><h4>{esc(s["name"])}</h4><p>{esc(s["text"])}</p></div></div>' for s in d.get("sources", []))
    return (f'<section class="s3 bg" data-label="{html.escape(d.get("label", d["title"]))}" style="background-image:url(assets/{d.get("bg", "frag-1.jpg")})">{LOGO}'
            f'<h2>{esc(d["title"])}</h2><div class="cols">{cols}</div><p class="punch">{esc(d.get("line", ""))}</p>'
            f'<div class="src">{src}</div>{frame(n)}</section>')


def compare(d, n, ui):
    data = html.escape(json.dumps(d["columns"], ensure_ascii=False), quote=True)
    lead = f'<p class="lead">{esc(d["lead"])}</p>' if d.get("lead") else ""
    stage = svg("where-we-stand", 1680, 620, extra=f" data-columns='{data}'")
    return (f'<section class="cmp" data-label="{html.escape(d.get("label", d["title"]))}">{LOGO}<h2>{esc(d["title"])}</h2>'
            f'{lead}{stage}{frame(n)}</section>')


def case(d, n, ui):
    band = d.get("band")
    h = 560 if band else 780
    gets = "".join(f'<div class="it">{ico("check-circle")}{esc(g)}</div>' for g in d["gets"])
    out = (f'<section class="case{" s8" if band else ""}" data-label="{html.escape(d.get("label", "Case"))}">{LOGO}<div class="left">'
           f'<h2>{esc(d["question"])}</h2><p class="why">{esc(d["why"])}</p>'
           f'<div class="gets"><div class="lbl">{ui["gets"]}</div>{gets}</div>'
           f'<div class="chips"><span class="chip">{esc(d["format"])}</span><span class="chip g">{esc(d["time"])}</span></div></div>'
           f'<div class="stage card">{svg(d["anim"], 920, h, d.get("labels"))}<span class="illus">{ui["illus"]}</span></div>')
    if band:
        def step(s):
            tag = f' <span>{esc(s["tag"])}</span>' if s.get("tag") else ""
            return f'<div class="step"><div class="n">{esc(s["name"])}{tag}</div><p>{esc(s["text"])}</p></div>'
        steps = ico("arrow-right", "grey", "ico arrow").join(step(s) for s in band["steps"])
        offer = band.get("offer", {})
        out += (f'<div class="band card"><div class="steps">{steps}</div><div class="offer"><h4>{esc(offer.get("title", ""))}</h4>'
                f'<p>{esc(offer.get("text", ""))}</p><p class="mail">{esc(offer.get("contact", "hola@noisia.ai · www.noisia.ai"))}</p></div></div>')
    return out + f"{frame(n)}</section>"


def menu(d, n, ui):
    cols = "".join(
        f'<div class="col card"><div class="hd"><span class="icobox">{ico(c["icon"])}</span><div><h3>{esc(c["name"])}</h3><p>{esc(c["sub"])}</p></div></div>'
        + "".join(f'<div class="row"><span>{esc(a)}</span><span class="chip g">{esc(b)}</span></div>' for a, b in c["rows"]) + "</div>"
        for c in d["cols"])
    return (f'<section class="s8e bg" data-label="{html.escape(d.get("label", d["title"]))}" style="background-image:url(assets/{d.get("bg", "frag-1.jpg")})">{LOGO}'
            f'<h2>{esc(d["title"])}</h2><p class="lead">{esc(d["lead"])}</p><div class="cols">{cols}</div>'
            f'<div class="lib">{ico("open-book")}<p><b>{esc(d["library"][0])}</b> {esc(d["library"][1])}</p></div>'
            f'<p class="close">{esc(d["close"])} <span class="t">{esc(d.get("contact", "hola@noisia.ai · www.noisia.ai"))}</span></p>{frame(n)}</section>')


def coverage(d, n, ui):
    types = "".join(f'<span class="chip g">{esc(t)}</span>' for t in d["types"])
    return (f'<section class="s9" data-label="{html.escape(d.get("label", d["title"]))}">{LOGO}<div class="left">'
            f'<h2>{esc(d["title"])}</h2><p class="why">{esc(d["why"])}</p>'
            f'<div class="big"><b>{esc(d["big"])}</b><span>{esc(d["big_label"])}</span></div><div class="types">{types}</div>'
            f'<p class="ose"><b>{esc(d.get("ose", "Owned · Shared · Earned"))}</b></p><p class="any">{esc(d.get("any", ""))}</p></div>'
            f'{svg("coverage-rings", 920, 780, d.get("labels"))}{frame(n)}</section>')


TYPES = {"cover": cover, "pillars": pillars, "ways": ways, "compare": compare, "case": case, "menu": menu, "coverage": coverage}


def kit_copy(lang, key):
    return json.load(open(os.path.join(COMM, "copy", f"{lang}.json"), encoding="utf-8"))[key]


def resolve(spec):
    """A compare slide can point at the kit's copy ("copy": "where_we_stand") instead of repeating it."""
    for d in spec["slides"]:
        if d["type"] == "compare" and "copy" in d:
            c = kit_copy(spec["lang"], d["copy"])
            d.setdefault("title", c["title"])
            d.setdefault("columns", c["columns"])
    return spec


def build(spec, out):
    spec = resolve(spec)
    ui = UI[spec["lang"]]
    os.makedirs(os.path.join(out, "assets"), exist_ok=True)
    for name, src in ASSETS.items():
        shutil.copyfile(src, os.path.join(out, "assets", name))
    shutil.copyfile(os.path.join(KIT, "engine", "deck-stage.js"), os.path.join(out, "deck-stage.js"))
    body = "\n\n".join(TYPES[d["type"]](d, i + 1, ui) for i, d in enumerate(spec["slides"]))
    used = sorted(set(re.findall(r'data-anim="([^"]+)"', body)))
    anims = "\n".join(open(os.path.join(HERE, "anims", f"{a}.js"), encoding="utf-8").read() for a in used)
    notes = [d.get("notes", "") for d in spec["slides"]]
    page = f"""<!doctype html>
<html lang="{spec["lang"]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(spec.get("title", "Noisia"))}</title>
<script type="application/json" id="speaker-notes">
{json.dumps(notes, ensure_ascii=False, indent=0)}
</script>
<style>
{open(os.path.join(HERE, "base.css"), encoding="utf-8").read()}{EXTRA_CSS}</style>
</head>
<body>
<deck-stage width="1920" height="1080">
{body}
</deck-stage>
<script src="deck-stage.js"></script>
<script>
{open(os.path.join(HERE, "engine.js"), encoding="utf-8").read()}
{anims}
{open(os.path.join(HERE, "lifecycle.js"), encoding="utf-8").read()}
</script>
</body>
</html>
"""
    for ch in "\u2014\u2013":
        if ch in page:
            sys.exit(f"build.py: a long dash ({ch!r}) is in the deck; COPY_RULES.md forbids it")
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(page)
    print(f"{out}/index.html · {len(spec['slides'])} slides · animations: {', '.join(used)}")
    return used


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--out", required=True)
    ap.add_argument("--pptx", action="store_true", help="also capture the GIFs and write the editable PPTX")
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8"))
    out = os.path.abspath(os.path.expanduser(a.out))
    build(spec, out)
    if a.pptx:
        for script in ("capture_gifs.py", "build_pptx.py"):
            r = subprocess.run([sys.executable, os.path.join(HERE, script), out, a.spec])
            if r.returncode:
                sys.exit(f"{script} failed")


if __name__ == "__main__":
    main()
