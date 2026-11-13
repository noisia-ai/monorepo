#!/usr/bin/env python3
"""
build_pptx.py: the editable PPTX of a credentials deck, from the same content JSON as the HTML.

    python3 build_pptx.py <deck dir built by build.py> <spec.json> [--out file.pptx]

Draws each slide with the kit's noisia_pptx primitives on the HTML's 1920x1080 grid: text, cards,
chips and icons are native and editable in Google Slides, and each animation goes in as the GIF that
capture_gifs.py wrote (it opens on its finished frame). The comparison is the kit's own native
where_we_stand slide. Speaker notes come from the spec.
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "builder"))
import noisia_pptx as N                                    # noqa: E402
from noisia_pptx import Deck, px, rgb, _lines, FONT        # noqa: E402
from pptx.util import Pt                                    # noqa: E402

sys.path.insert(0, HERE)
from build import UI, resolve                               # noqa: E402

INK, FG, FG2, FG3 = "0a0a0a", "2b2b2b", "6d6d6d", "9a9a9a"
TEAL, TEAL_SOFT, SURFACE, BORDER, GREY = "008a8a", "e6f7f7", "fafafa", "eeeeee", "f1f1f1"
LOGO = os.path.join(N.ASSETS, "logo", "noisia.png")


class Builder:
    def __init__(self, spec, gifs):
        self.spec, self.gifs, self.ui = spec, gifs, UI[spec["lang"]]
        self.deck = os.path.dirname(gifs)
        self.K = Deck(lang=spec["lang"], mode="present")

    # ------------------------------------------------------------ primitives (from the two decks)
    def nlines(self, text, w, size, bold=False):
        return _lines(re.sub(r"\*\*", "", text), w, size, bold)

    def block(self, s, x, y, w, text, size, color=FG, bold=False, lh=1.3, align="l"):
        """Text box sized to its measured lines. Returns the y below it."""
        h = self.nlines(text, w, size, bold) * size * lh
        self.K.text(s, x, y, w, h + 2, text, size, color, bold=bold, lh=lh, align=align, fit_box=False)
        return y + h

    def rich(self, s, x, y, w, h, runs, size, lh=1.3):
        tb = s.shapes.add_textbox(px(x), px(y), px(w), px(h))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.line_spacing = round(lh / 1.2, 3)
        for t, c, b in runs:
            r = p.add_run(); r.text = t
            f = r.font; f.name = FONT; f.size = Pt(size * 0.5); f.bold = b; f.color.rgb = rgb(c)

    def text_w(self, text, size, bold=False):
        m = N._measurer()
        return m.get(size, bold).getlength(text) if m else len(text) * size * 0.56

    def chip(self, s, x, y, label, grey=False, size=20, h=44, padx=20, bold=True):
        w = self.text_w(label, size, bold) + 2 * padx
        self.K.box(s, x, y, w, h, fill=GREY if grey else TEAL_SOFT, line=None, radius=h / 2)
        self.K.text(s, x, y, w, h, label, size, FG2 if grey else TEAL, bold=bold, align="c", anchor="m", fit_box=False)
        return w

    def chips(self, s, x, y, labels, maxw, size=20, h=44, padx=20, gap=12, bottom=None):
        """Wrapping row of chips, (text, grey). Grey chips are regular weight: bold ones wrapped too much."""
        rows, cx = [[]], x
        for lab, grey in labels:
            w = self.text_w(lab, size, not grey) + 2 * padx
            if cx > x and cx + w > x + maxw:
                rows.append([]); cx = x
            rows[-1].append((lab, grey, cx)); cx += w + gap
        if bottom is not None:
            y = bottom - len(rows) * h - (len(rows) - 1) * gap
        for r, row in enumerate(rows):
            for lab, grey, cx in row:
                self.chip(s, cx, y + r * (h + gap), lab, grey, size, h, padx, bold=not grey)
        return y + len(rows) * (h + gap) - gap

    def frame(self, s, numbered=True, foot_color=FG3):
        self.K.image(s, LOGO, 120, 64, h=34, name="Logo Noisia")
        if numbered:
            self.K.text(s, 120, 1006, 400, 24, "noisia.ai", 18, FG3, fit_box=False)
            self.K.slide_number(s, 1600, 1006, 200, 24, color=foot_color)

    def gif(self, s, n, x, y, w, h):
        path = os.path.join(self.gifs, f"a{n}.gif")
        if not os.path.exists(path):
            sys.exit(f"build_pptx.py: {path} is missing; run capture_gifs.py first")
        self.K.image(s, path, x, y, w=w, h=h, name=f"Animation {n}")

    # ------------------------------------------------------------ slide types
    def cover(self, d, n):
        s = self.K.new(bg=d.get("bg", "cover-2.jpg"), notes=d.get("notes", ""))
        self.frame(s, False)
        self.K.text(s, 120, 300, 1060, 3 * 84 * 1.08 + 4, d["title"], 84, INK, bold=True, lh=1.08, fit_box=False)
        self.block(s, 120, 690, 900, d.get("sub", ""), 32, FG2, lh=1.35)
        self.K.text(s, 120, 930, 600, 30, d.get("date", ""), 22, FG2, fit_box=False)

    def pillars(self, d, n):
        s = self.K.new(notes=d.get("notes", ""))
        self.frame(s)
        self.K.text(s, 120, 150, 1680, 74, d["title"], 60, INK, bold=True, lh=1.15, fit_box=False)
        self.block(s, 120, 248, 1300, d["lead"], 27, FG2, lh=1.4)
        self.gif(s, n, 120, 370, 1680, 400)
        for i, p in enumerate(d["pillars"]):
            x = 120 + i * 420
            if p.get("icon"):
                self.K.icon(s, p["icon"], x, 802, size=34)
            else:
                self.K.box(s, x, 800, 38, 38, fill=TEAL_SOFT, line=None, shape="oval")
                self.K.text(s, x, 800, 38, 38, str(i + 1), 19, TEAL, bold=True, align="c", anchor="m", fit_box=False)
            self.K.text(s, x + 52, 800, 340, 38, p["title"], 25, INK, bold=True, anchor="m", fit_box=False)
            self.block(s, x, 848, 384, p["text"], 21, FG2, lh=1.4)

    def ways(self, d, n):
        s = self.K.new(bg=d.get("bg", "frag-1.jpg"), notes=d.get("notes", ""))
        self.frame(s, True, foot_color="ffffff")
        self.K.text(s, 120, 150, 1500, 74, d["title"], 60, INK, bold=True, lh=1.15, fit_box=False)
        for i, c in enumerate(d["cols"]):
            x0 = 120 + i * (736 + 28)
            self.K.box(s, x0, 262, 736, 500, fill=SURFACE, line=BORDER, radius=16)
            x, w = x0 + 44, 648
            self.K.icobox(s, c["icon"], x, 300, size=72)
            self.K.text(s, x + 92, 300, 500, 72, c["name"], 40, INK, bold=True, anchor="m", fit_box=False)
            y = self.block(s, x, 390, w, c["lead"], 23, FG2, lh=1.4) + 24
            for q in c["questions"]:
                self.K.box(s, x, y + 20, 10, 10, fill=TEAL, line=None, shape="oval")
                y = self.block(s, x + 28, y + 9, w - 28, q, 22, FG, lh=1.3) + 9
            self.chips(s, x, y + 26, [(t, True) for t in c["chips"]], w, size=18, h=38, padx=16, gap=10)
        line = d.get("line", "")
        m = re.match(r"(.*?)\*\*(.+?)\*\*(.*)", line)
        runs = [(m.group(1), FG, False), (m.group(2), INK, True), (m.group(3), FG, False)] if m else [(line, FG, False)]
        self.rich(s, 120, 792, 1500, 40, [r for r in runs if r[0]], 28)
        srcs = d.get("sources", [])
        cw = (1500 - 56) / 3
        for i, c in enumerate(srcs):
            x = 120 + i * (cw + 28)
            self.K.icon(s, c["icon"], x, 858, size=40)
            self.K.text(s, x + 56, 858, cw - 56, 30, c["name"], 22, INK, bold=True, fit_box=False)
            self.block(s, x + 56, 892, cw - 56, c["text"], 18, FG2, lh=1.4)

    def compare(self, d, n):
        # The kit's native slide: editable columns, same copy as the HTML animation.
        self.K.where_we_stand({"type": "where_we_stand", "title": d["title"], "columns": d["columns"], "notes": d.get("notes", "")})

    def case(self, d, n):
        band = d.get("band")
        s = self.K.new(notes=d.get("notes", ""))
        self.frame(s)
        colh = 560 if band else 800
        y = self.block(s, 120, 150, 690, d["question"], 54, INK, bold=True, lh=1.12)
        y = self.block(s, 120, y + 26, 690, d["why"], 25, FG2, lh=1.42) + 40
        self.K.text(s, 120, y, 690, 26, self.ui["gets"], 20, FG2, bold=True, fit_box=False)
        y += 40
        for it in d["gets"]:
            self.K.icon(s, "check-circle", 120, y + 9, size=32)
            y = self.block(s, 166, y + 8, 644, it, 23, FG, lh=1.38) + 8
        self.chips(s, 120, 0, [(d["format"], False), (d["time"], True)], 690, bottom=150 + colh)
        sh = 560 if band else 780
        self.K.box(s, 880, 150, 920, sh, fill=SURFACE, line=None, radius=16)
        self.gif(s, n, 880, 150, 920, sh)
        self.K.box(s, 880, 150, 920, sh, fill=None, line=BORDER, radius=16)
        self.K.text(s, 880 + 920 - 24 - 300, 150 + sh - 18 - 22, 300, 22, self.ui["illus"], 17, FG3, align="r", fit_box=False)
        if band:
            self._band(s, band)

    def _band(self, s, band):
        K = self.K
        K.box(s, 120, 760, 1680, 190, fill=SURFACE, line=BORDER, radius=16)
        inner_w = 1600
        c1 = (inner_w - 40) * 1.25 / 2.25
        steps = band["steps"]
        sw = (c1 - (len(steps) - 1) * 28 - (len(steps) - 1) * 2 * 16) / len(steps)
        hs = [30 + 6 + self.nlines(st["text"], sw, 18) * 18 * 1.35 for st in steps]
        top = 790 + (130 - max(hs)) / 2
        x = 160
        for j, st in enumerate(steps):
            K.text(s, x, top, sw, 30, st["name"], 24, INK, bold=True, anchor="m", fit_box=False)
            if st.get("tag"):
                pw = self.text_w(st["tag"], 15, False) + 20
                nx = x + self.text_w(st["name"], 24, True) + 10
                K.box(s, nx, top + 3, pw, 24, fill=TEAL_SOFT, line=None, radius=12)
                K.text(s, nx, top + 3, pw, 24, st["tag"], 15, TEAL, align="c", anchor="m", fit_box=False)
            self.block(s, x, top + 36, sw, st["text"], 18, FG2, lh=1.35)
            x += sw + 16
            if j < len(steps) - 1:
                K.icon(s, "arrow-right", x, 790 + 65 - 14, size=28, tone="grey")
                x += 28 + 16
        ox = 160 + c1 + 40
        ln = s.shapes.add_connector(1, px(ox), px(790), px(ox), px(920))
        ln.line.color.rgb = rgb(BORDER); ln.line.width = Pt(0.75)
        offer = band.get("offer", {})
        tx, tw = ox + 40, inner_w - c1 - 40 - 40
        oh = 30 + 8 + self.nlines(offer.get("text", ""), tw, 19) * 19 * 1.4 + 12 + 26
        oy = 790 + (130 - oh) / 2
        K.text(s, tx, oy, tw, 30, offer.get("title", ""), 24, INK, bold=True, fit_box=False)
        y2 = self.block(s, tx, oy + 38, tw, offer.get("text", ""), 19, FG2, lh=1.4)
        K.text(s, tx, y2 + 12, tw, 26, offer.get("contact", "hola@noisia.ai · www.noisia.ai"), 20, TEAL, bold=True, fit_box=False)

    def menu(self, d, n):
        K = self.K
        s = K.new(bg=d.get("bg", "frag-1.jpg"), notes=d.get("notes", ""))
        self.frame(s, True, foot_color="ffffff")
        K.text(s, 120, 150, 1500, 74, d["title"], 60, INK, bold=True, lh=1.15, fit_box=False)
        self.block(s, 120, 248, 1400, d["lead"], 27, FG2, lh=1.4)
        for i, c in enumerate(d["cols"]):
            x0 = 120 + i * (736 + 28)
            K.box(s, x0, 370, 736, 340, fill=SURFACE, line=BORDER, radius=16)
            x, w = x0 + 40, 656
            K.icobox(s, c["icon"], x, 404, size=72)
            K.text(s, x + 92, 406, 500, 50, c["name"], 36, INK, bold=True, fit_box=False)
            K.text(s, x + 92, 452, 500, 26, c["sub"], 20, FG2, fit_box=False)
            y = 492
            for label, time in c["rows"]:
                K.rule(s, x, y, w)
                K.text(s, x, y, 420, 64, label, 24, FG, anchor="m", fit_box=False)
                cw = self.text_w(time, 18, False) + 32
                self.chip(s, x + w - cw, y + 13, time, grey=True, size=18, h=38, padx=16, bold=False)
                y += 64
        K.icon(s, "open-book", 120, 784, size=40)
        self.rich(s, 176, 786, 1440, 40, [(d["library"][0] + " ", INK, True), (d["library"][1], FG, False)], 24)
        self.rich(s, 120, 868, 1500, 40, [(d["close"] + "  ", FG2, False),
                                          (d.get("contact", "hola@noisia.ai · www.noisia.ai"), TEAL, True)], 22)

    def coverage(self, d, n):
        K = self.K
        s = K.new(notes=d.get("notes", ""))
        self.frame(s)
        y = self.block(s, 120, 150, 690, d["title"], 60, INK, bold=True, lh=1.12)
        y = self.block(s, 120, y + 24, 690, d["why"], 25, FG2, lh=1.42) + 44
        K.text(s, 120, y, 300, 120, d["big"], 112, TEAL, bold=True, lh=1.0, fit_box=False)
        bw = self.text_w(d["big"], 112, True)
        self.block(s, 120 + bw + 18, y + 44, 300, d["big_label"], 24, FG, lh=1.35)
        y += 152
        y = self.chips(s, 120, y, [(t, True) for t in d["types"]], 690, size=19, h=42, padx=18, gap=10) + 34
        K.text(s, 120, y, 690, 32, d.get("ose", "Owned · Shared · Earned"), 24, INK, bold=True, fit_box=False)
        self.block(s, 120, y + 42, 690, d.get("any", ""), 22, FG2, lh=1.4)
        self.gif(s, n, 880, 150, 920, 780)

    def website(self, d, n):
        """A noisia.ai animation as the GIF from website-assets.mjs, opening on its finished frame."""
        K = self.K
        s = K.new(notes=d.get("notes", ""))
        self.frame(s)
        y = self.block(s, 120, 150, 820, d["title"], 54, INK, bold=True, lh=1.12)
        y = self.block(s, 120, y + 26, 820, d.get("why", ""), 25, FG2, lh=1.42) + 40
        for it in d.get("items", []):
            K.icon(s, "check-circle", 120, y + 9, size=32)
            y = self.block(s, 166, y + 8, 774, it, 23, FG, lh=1.38) + 8
        gif = os.path.join(self.deck, "web", f'{d["anim"]}.{self.spec["lang"]}.gif')
        if not os.path.exists(gif):
            sys.exit(f"build_pptx.py: {gif} is missing; build.py renders it")
        K.box(s, 1020, 150, 780, 780, fill="ffffff", line=None, radius=16)
        K.image(s, gif, 1020, 150, w=780, h=780, name=f"Animation {d['anim']}")
        K.box(s, 1020, 150, 780, 780, fill=None, line=BORDER, radius=16)

    def build(self, out):
        for i, d in enumerate(self.spec["slides"]):
            getattr(self, d["type"])(d, i + 1)
        self.K.finish_notes()
        self.K.prs.save(out)
        print(out, f"{os.path.getsize(out) / 1e6:.2f} MB")
        for w in self.K.warnings:
            print("AVISO:", w)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("deck")
    ap.add_argument("spec")
    ap.add_argument("--out")
    a = ap.parse_args()
    deck = os.path.abspath(os.path.expanduser(a.deck))
    spec = resolve(json.load(open(a.spec, encoding="utf-8")))
    out = a.out or os.path.join(deck, f"Noisia_Credenciales_{spec['lang'].upper()}.pptx")
    Builder(spec, os.path.join(deck, "gifs")).build(out)


if __name__ == "__main__":
    main()
