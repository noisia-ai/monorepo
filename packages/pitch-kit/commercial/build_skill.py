#!/usr/bin/env python3
"""
build_skill.py — package the commercial kit as the claude.ai skill `noisia-comercial`.

    python3 commercial/build_skill.py [--fonts <dir with GoogleSans*.ttf>]   # a release
    python3 commercial/build_skill.py --status    # what changed since the last release
    python3 commercial/build_skill.py --dev       # a test build from any tree

Writes dist/noisia-comercial/ and dist/noisia-comercial-v<VERSION>.zip (the folder at the zip
root, as claude.ai expects, so a new version replaces the old one when uploaded).

RELEASES. The skill does not update itself: each person re-uploads it by hand, so a release is a
deliberate, manual commit, made only when the diff is worth a reinstall (skill/RELEASES.md says
when and how). The version lives in skill/VERSION, travels inside SKILL.md, names the zip, and
is tagged in git as skill-comercial-v<VERSION>. A release build refuses a dirty tree, a HEAD that
does not contain origin/main, a version without its row in RELEASES.md, or a version whose tag
already points at another commit; --dev skips those checks and marks the zip as a test build. Upload the zip in claude.ai: Organization settings > Skills on a Team plan
(everyone gets it, and updates replace it for all), or Customize > Skills on a personal account
(each person uploads it, and each update too).

Google Sans travels inside the skill from commercial/fonts/: static Regular, Medium and Bold
instances cut from the variable font in github.com/google/fonts (ofl/googlesans), subset to Latin,
with its OFL license next to them. With it, the builder measures text with the real font and the
PDF exported in the sandbox uses it too. Never package a font whose license does not allow it.

Private values never live in this public repo. The link to the Leads folder in the commercial
Drive goes in commercial/.private.json ({"leads_folder_url": "..."}, git-ignored) or in
--leads-folder, and is written into SKILL.md at packaging time. Without it, the skill delivers the
files for download instead of uploading them.

The zip is checked against claude.ai's limit of 200 files before it is written.

dist/ is git-ignored: the zip is a build output, the source is this folder.
"""
import argparse, os, re, shutil, subprocess, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
NAME = "noisia-comercial"
TAG = "skill-comercial-v"

# What travels inside the skill, grouped by what it changes for the person using it.
GROUPS = [
    ("Lo que sale en el deck", ["copy", "recipes.json", "assets", "fonts", "builder/noisia_pptx.py"]),
    ("Cómo trabaja la skill", ["skill/SKILL.md", "COMMERCIAL.md", "INDUSTRIES.md", "examples"]),
    ("Scripts", ["builder/build_deck.py", "builder/compose.py", "builder/preview.py"]),
]


def git(*args):
    return subprocess.run(["git", *args], cwd=HERE, capture_output=True, text=True).stdout.strip()


def version():
    return open(os.path.join(HERE, "skill", "VERSION"), encoding="utf-8").read().strip()


def last_tag():
    tags = git("tag", "-l", TAG + "*").split()
    key = lambda t: [int(x) for x in re.findall(r"\d+", t[len(TAG):])]
    return max(tags, key=key) if tags else None


def status():
    tag = last_tag()
    if not tag:
        raise SystemExit("No hay ninguna release con tag todavía (skill-comercial-v*).")
    print(f"Desde {tag} ({git('log', '-1', '--format=%h %ad', '--date=short', tag)}) · VERSION dice {version()}\n")
    visible = False
    for title, paths in GROUPS:
        stat = git("diff", "--stat=100", tag, "HEAD", "--", *paths)
        if not stat:
            continue
        visible |= title != "Cómo trabaja la skill" or "skill/SKILL.md" in stat
        print(f"{title}:")
        for line in stat.splitlines()[:-1]:
            print("  " + line.strip().replace("packages/pitch-kit/commercial/", ""))
        print()
    every = [p for _, ps in GROUPS for p in ps]
    log = "\n".join("  " + l for l in git("log", "--format=%h %s", f"{tag}..HEAD", "--", *every).splitlines())
    if not log:
        print("Nada cambió en la skill desde la última release.")
        return
    print("Commits:\n" + log + "\n")
    print("Veredicto: " + ("hay cambios que se ven en el deck, en el flujo o en los scripts; vale una release "
                           "si alguno les pega (skill/RELEASES.md)." if visible else
                           "solo cambiaron reglas de referencia; puede esperar a juntarse con lo siguiente."))


def release_checks(v):
    if git("status", "--porcelain", "--", "."):
        raise SystemExit("El kit comercial tiene cambios sin commit. Una release se arma desde main limpio (o usa --dev).")
    git("fetch", "-q", "origin")
    behind = subprocess.run(["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"], cwd=HERE).returncode
    if behind:
        raise SystemExit("HEAD no está al día con origin/main. Una release se arma desde main o desde su rama "
                         "de release al día con main (o usa --dev).")
    tagged = git("rev-list", "-n", "1", TAG + v)
    if tagged and tagged != git("rev-parse", "HEAD"):
        raise SystemExit(f"La versión {v} ya salió en otro commit. Sube skill/VERSION y su fila en skill/RELEASES.md.")
    if f"| {v} |" not in open(os.path.join(HERE, "skill", "RELEASES.md"), encoding="utf-8").read():
        raise SystemExit(f"skill/RELEASES.md no tiene la fila de la versión {v}.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fonts", help="folder with GoogleSans TTF files to bundle")
    ap.add_argument("--leads-folder", help="Drive URL of the Leads folder (else .private.json)")
    ap.add_argument("--status", action="store_true", help="what changed since the last release")
    ap.add_argument("--dev", action="store_true", help="test build: skip the release checks")
    a = ap.parse_args()
    if a.status:
        return status()
    v = version()
    if not a.dev:
        release_checks(v)
    label = v if not a.dev else f"{v}-dev ({git('rev-parse', '--short', 'HEAD')}, no publicada)"
    out = os.path.join(DIST, NAME)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    import json
    priv = os.path.join(HERE, ".private.json")
    leads = a.leads_folder or (json.load(open(priv)).get("leads_folder_url") if os.path.exists(priv) else None)
    skill = open(os.path.join(HERE, "skill", "SKILL.md"), encoding="utf-8").read()
    skill = skill.replace("{{LEADS_FOLDER_URL}}", leads or "(no configurada: entrega para descargar)")
    skill = skill.replace("{{VERSION}}", label)
    open(os.path.join(out, "SKILL.md"), "w", encoding="utf-8").write(skill)
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
    os.makedirs(os.path.join(out, "fonts"))
    for src in [os.path.join(HERE, "fonts")] + ([a.fonts] if a.fonts else []):
        if not os.path.isdir(src):
            continue
        for f in os.listdir(src):
            if f == "OFL.txt" or (f.lower().endswith(".ttf") and "googlesans" in f.lower().replace(" ", "").replace("-", "")):
                shutil.copy(os.path.join(src, f), os.path.join(out, "fonts", f))
                fonts += f.endswith(".ttf")
    count = sum(len(fs) for _, _, fs in os.walk(out))
    if count > 200:
        raise SystemExit(f"{count} archivos: claude.ai acepta como máximo 200. Junta assets en sprites.")
    z = os.path.join(DIST, f"{NAME}-v{v}{'-dev' if a.dev else ''}.zip")
    if os.path.exists(z):
        os.remove(z)
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(out):
            for f in files:
                if f.startswith(".") or f.endswith(".pyc"):
                    continue
                p = os.path.join(root, f)
                zf.write(p, os.path.relpath(p, DIST))
    print(f"{z} · versión {label} · {os.path.getsize(z) / 1e6:.1f} MB · {count} archivos · {fonts} fuentes"
          f" · Leads: {'sí' if leads else 'no'}")
    if not a.dev:
        print(f"Siguiente: git tag -a {TAG}{v} -m \"{NAME} v{v}\" && git push origin {TAG}{v}")
    if not fonts:
        print("aviso: sin Google Sans empaquetada. El PDF del sandbox usará otra fuente; el de Google Slides sale bien.")


if __name__ == "__main__":
    main()
