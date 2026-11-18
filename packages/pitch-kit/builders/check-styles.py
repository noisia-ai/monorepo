#!/usr/bin/env python3
"""
check-styles.py: falla el build si el deck trae un estilo que el kit prohíbe.

    python3 builders/check-styles.py <deck-dir>/index.html

En un caso, dos cortes seguidos volvieron a meter franjas de color en cards ya corregidas y hubo que
pedir dos veces que se quitaran. Una regla que se revisa a mano se pierde al rehacer una slide; esta
se revisa en cada build. Revisa el <style> del deck, los atributos style="" y las hojas CSS propias
del deck (no las cuatro del engine):

- border-left / border-top de color o de más de 1px (la franja de color en una card). Una línea
  fina neutra (1px con --border-subtle, --border-medium o un gris) pasa.
- box-shadow, filter y mask-image, que no se imprimen igual (los no negociables del prompt maestro).
- em dash en cualquier parte del HTML, incluido el <title>.

Para una excepción con motivo, la línea lleva el comentario `check-styles: allow` (en CSS
`/* check-styles: allow <motivo> */`). Sale con 1 si encuentra algo. Solo biblioteca estándar.
"""
import os, re, sys

ENGINE = {"noisia-tokens.css", "deck.css", "deck-components.css"}
NEUTRAL_VARS = {"--border-subtle", "--border-medium", "--neutral-03", "--neutral-04", "--neutral-05",
                "--neutral-09", "--neutral-10", "--neutral-11", "--surface-01", "--surface-02",
                "--surface-03", "--bg-sunken", "--whisper"}
NAMED_NEUTRAL = {"transparent", "currentcolor", "white", "black", "inherit", "initial", "unset"}
ALLOW = "check-styles: allow"


def is_grey(hexv):
    h = hexv.lstrip("#")
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h[:3])
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return max(r, g, b) - min(r, g, b) <= 10


def colored_border(value):
    v = value.strip().lower()
    if v in ("none", "0", "0px") or v.startswith("none"):
        return None
    w = re.search(r"(\d+(?:\.\d+)?)px", v)
    if w and float(w.group(1)) > 1:
        return f"{w.group(1)}px"
    for var in re.findall(r"var\((--[a-z0-9-]+)", v):
        if var not in NEUTRAL_VARS:
            return var
    for hx in re.findall(r"#[0-9a-f]{3,8}\b", v):
        if not is_grey(hx):
            return hx
    if re.search(r"rgba?\(", v):
        nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", v.split("rgb", 1)[1])[:3]]
        if len(nums) == 3 and max(nums) - min(nums) > 10:
            return "rgb de color"
    for word in re.findall(r"\b[a-z]+\b", v):
        if word in ("solid", "dashed", "dotted", "px", "none", "var") or word in NAMED_NEUTRAL:
            continue
        if word in ("red", "teal", "coral", "cyan", "orange", "green", "blue", "yellow", "purple", "pink"):
            return word
    return None


def scan_css(text, where):
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if ALLOW in line:
            continue
        for prop, val in re.findall(r"(?<![\w-])([a-z-]+)\s*:\s*([^;}\"]+)", line, flags=re.I):
            p = prop.lower()
            if p in ("border-left", "border-top", "border-left-color", "border-top-color",
                     "border-left-width", "border-top-width"):
                why = colored_border(val)
                if why:
                    hits.append((where, n, f"{p}: {val.strip()}  (franja: {why})"))
            elif p in ("box-shadow", "-webkit-box-shadow") and val.strip().lower() != "none":
                hits.append((where, n, f"{p}: {val.strip()}"))
            elif p in ("filter", "-webkit-filter") and val.strip().lower() != "none":
                hits.append((where, n, f"{p}: {val.strip()}"))
            elif p in ("mask-image", "-webkit-mask-image", "mask", "-webkit-mask") and val.strip().lower() != "none":
                hits.append((where, n, f"{p}: {val.strip()}"))
    return hits


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    deck = os.path.dirname(os.path.abspath(path))
    src = open(path, encoding="utf-8").read()
    hits = []

    for n, line in enumerate(src.splitlines(), 1):
        if "—" in line and ALLOW not in line:
            hits.append((os.path.basename(path), n, "em dash"))

    # <style> blocks and style="" attributes, keeping line numbers of the HTML
    for m in re.finditer(r"<style\b[^>]*>(.*?)</style>", src, flags=re.S | re.I):
        base = src.count("\n", 0, m.start(1))
        for where, n, msg in scan_css(m.group(1), os.path.basename(path)):
            hits.append((where, n + base, msg))
    for m in re.finditer(r'style\s*=\s*"([^"]*)"', src, flags=re.I):
        line_no = src.count("\n", 0, m.start()) + 1
        line = src.splitlines()[line_no - 1]
        if ALLOW in line:
            continue
        for _, _, msg in scan_css(m.group(1), ""):
            hits.append((os.path.basename(path), line_no, msg))

    for href in re.findall(r'<link\b[^>]*href="([^"]+\.css)"', src, flags=re.I):
        if os.path.basename(href) in ENGINE or href.startswith(("http:", "https:")):
            continue
        css = os.path.normpath(os.path.join(deck, href))
        if os.path.exists(css):
            hits += scan_css(open(css, encoding="utf-8").read(), os.path.relpath(css, deck))

    for where, n, msg in hits:
        print(f"{where}:{n}: {msg}")
    print(f"check-styles: {len(hits)} problema(s)" if hits else "check-styles: limpio")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
