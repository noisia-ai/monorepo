#!/usr/bin/env python3
"""
build_deck.py — turn a deck spec (JSON) into an editable PPTX, and a PDF if asked.

    python3 build_deck.py spec.json out.pptx [--pdf]

The spec is what the agent writes after the interview (COMMERCIAL.md §3): language, version
(present or send), and the slide list, each slide a `type` from the library plus its fields.
Canonical copy comes from copy/<lang>.json; only the client-specific fields are written fresh.

Before saving, the spec goes through the gates that make a deck Noisia's and not AI slop:
no em dash, no leftover {{PLACEHOLDER}}, no forbidden phrasing, every price written as XXX
unless the person filled it in. A failed gate stops the build and says where.

PDF: LibreOffice when it exists (the claude.ai sandbox has it; call it through the
`soffice.py` wrapper there if a direct call hangs), Keynote on a Mac, otherwise the PPTX
opens in Google Slides and File > Download > PDF gives the same result.
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from noisia_pptx import Deck, SLIDES  # noqa: E402

# Phrases that read as AI or as internal process on a client slide. COPY_RULES.md §2 and the
# commercial gate in COMMERCIAL.md §6. Lower-case substrings.
FORBIDDEN = {
    "es": ["no es solo", "no se trata de", "más que un", "jugadas", "sentione", "talkwalker",
           "brandwatch", "youscan", "land & expand", "land and expand", "backbone", "prueba de valor",
           "nota interna", "lorem", "revolucion", "potencia tu", "desbloquea", "sinergia",
           "de clase mundial", "vanguardia", "en el panorama actual", "sin precedentes"],
    "en": ["not just", "it's not about", "more than just", "land & expand", "land and expand",
           "backbone", "prove value before", "internal note", "todo:", "lorem", "supercharge",
           "unlock", "world-class", "cutting-edge", "game-chang", "revolutioniz", "synergy",
           "in today's landscape", "unprecedented", "sentione", "talkwalker", "brandwatch"],
}


def strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("notes", "link_url", "client_logo", "thumbnail", "type", "bg", "icon",
                     "eyebrow_icon", "brands"):
                continue
            yield from strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from strings(v, f"{path}[{i}]")


def gates(spec):
    lang = spec.get("lang", "es")
    errors = []
    for n, sl in enumerate(spec["slides"], 1):
        if sl.get("type") not in SLIDES:
            errors.append(f"slide {n}: tipo '{sl.get('type')}' no existe en la librería")
        for p, t in strings(sl):
            low = t.lower()
            if "—" in t or " – " in t:
                errors.append(f"slide {n}{p}: em dash, reescríbelo con punto o coma")
            if "{{" in t or "}}" in t:
                errors.append(f"slide {n}{p}: quedó un placeholder")
            for f in FORBIDDEN.get(lang, []):
                if re.search(r"(?<!\w)" + re.escape(f), low):
                    errors.append(f"slide {n}{p}: frase prohibida «{f}»")
    return errors


def to_pdf(pptx, pdf):
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        out = os.path.dirname(os.path.abspath(pdf))
        subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", out, pptx],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
        made = os.path.join(out, os.path.splitext(os.path.basename(pptx))[0] + ".pdf")
        if made != os.path.abspath(pdf):
            shutil.move(made, pdf)
        return pdf
    if sys.platform == "darwin" and os.path.exists("/Applications/Keynote.app"):
        script = f'''
        tell application "Keynote"
          set d to open POSIX file "{os.path.abspath(pptx)}"
          export d to POSIX file "{os.path.abspath(pdf)}" as PDF with properties {{PDF image quality:Best}}
          close d saving no
        end tell'''
        subprocess.run(["osascript", "-e", script], check=True, timeout=300)
        return pdf
    return None


def build(spec, out, pdf=False):
    errs = gates(spec)
    if errs:
        print("NO SE CONSTRUYÓ. Corrige esto en el spec:")
        for e in errs:
            print("  ·", e)
        sys.exit(1)
    deck = Deck(lang=spec.get("lang", "es"), mode=spec.get("mode", "send"),
                header_right=spec.get("header_right", "noisia.ai"), portrait=spec.get("portrait", False))
    for sl in spec["slides"]:
        SLIDES[sl["type"]](deck, sl)
    deck.save(out)
    raw = json.dumps(spec, ensure_ascii=False)
    xxx = raw.count("XXX")
    print(f"listo: {out} · {deck.n} slides · {spec.get('lang')} · versión {spec.get('mode', 'send')}")
    if xxx:
        print(f"  {xxx} precio(s) en XXX: se llenan en el editable antes de mandarlo")
    for w in deck.warnings:
        print("  aviso:", w)
    if pdf:
        p = os.path.splitext(out)[0] + ".pdf"
        try:
            r = to_pdf(out, p)
        except Exception as e:  # LibreOffice can hang or fail in a sandbox; the PPTX is still good
            print(f"  pdf: la exportación falló ({e.__class__.__name__})")
            r = None
        print(f"  pdf: {r}" if r else "  pdf: sin LibreOffice ni Keynote aquí. Abre el PPTX en Google Slides > Archivo > Descargar > PDF")
    return deck


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("uso: python3 build_deck.py spec.json out.pptx [--pdf]")
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    build(spec, sys.argv[2], pdf="--pdf" in sys.argv)
