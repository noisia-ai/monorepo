#!/usr/bin/env python3
"""
build_skill.py — package the commercial kit as the claude.ai skill `noisia-comercial`.

    python3 commercial/build_skill.py [--fonts <dir with GoogleSans*.ttf>]

Writes dist/noisia-comercial/ and dist/noisia-comercial.zip (the folder at the zip root, as
claude.ai expects). Upload the zip in claude.ai: Organization settings > Skills on a Team plan
(everyone gets it, and updates replace it for all), or Customize > Skills on a personal account
(each person uploads it, and each update too).

Fonts are optional but recommended: with Google Sans inside the skill, the PDF exported in the
sandbox and the overflow check both use the real font. Google Sans is open source (OFL) since
late 2025; get it from Google Fonts. Never package a font whose license does not allow it.

dist/ is git-ignored: the zip is a build output, the source is this folder.
"""
import argparse, os, shutil, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
NAME = "noisia-comercial"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", help="folder with GoogleSans TTF files to bundle")
    a = ap.parse_args()
    out = os.path.join(DIST, NAME)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    shutil.copy(os.path.join(HERE, "skill", "SKILL.md"), out)
    os.makedirs(os.path.join(out, "reference"))
    for f in ("COMMERCIAL.md", "INDUSTRIES.md"):
        shutil.copy(os.path.join(HERE, f), os.path.join(out, "reference", f))
    shutil.copy(os.path.join(HERE, "recipes.json"), out)
    shutil.copytree(os.path.join(HERE, "copy"), os.path.join(out, "copy"))
    shutil.copytree(os.path.join(HERE, "examples"), os.path.join(out, "examples"))
    shutil.copytree(os.path.join(HERE, "assets"), os.path.join(out, "assets"))
    os.makedirs(os.path.join(out, "scripts"))
    for f in ("noisia_pptx.py", "build_deck.py", "compose.py", "preview.py"):
        shutil.copy(os.path.join(HERE, "builder", f), os.path.join(out, "scripts", f))
    fonts = 0
    if a.fonts:
        os.makedirs(os.path.join(out, "fonts"))
        for f in os.listdir(a.fonts):
            if f.lower().endswith(".ttf") and "googlesans" in f.lower().replace(" ", "").replace("-", ""):
                shutil.copy(os.path.join(a.fonts, f), os.path.join(out, "fonts", f))
                fonts += 1
    z = os.path.join(DIST, f"{NAME}.zip")
    if os.path.exists(z):
        os.remove(z)
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(out):
            for f in files:
                if f.startswith(".") or f.endswith(".pyc"):
                    continue
                p = os.path.join(root, f)
                zf.write(p, os.path.relpath(p, DIST))
    print(f"{z} · {os.path.getsize(z) / 1e6:.1f} MB · {fonts} fuentes")
    if not fonts:
        print("aviso: sin Google Sans empaquetada. El PDF del sandbox usará otra fuente; el de Google Slides sale bien.")


if __name__ == "__main__":
    main()
