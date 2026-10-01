#!/usr/bin/env python3
"""
leak-check.py — fail the build if anything from the briefing leaks into a client deck.

    python3 builders/leak-check.py <deck-dir>/index.html --names names.txt
    python3 builders/leak-check.py <deck-dir>/index.html --names names.txt --notes-only

Reads the VISIBLE text of every slide AND the speaker notes (the notes travel inside the HTML
even though nobody sees them on screen), and looks for two things:

  · names that came from the briefing: the people who asked for things, suppliers, partners,
    restrictions said in private. One per line in names.txt, which lives in the CASE folder,
    never in this repo.
  · process vocabulary: words that only make sense to whoever built the deck.

Exits 1 with every hit and its slide number, so it can sit in front of build-pdf.mjs.

Two separate cases asked for this. In one, the name of the person who proposed a hypothesis
and the name of the survey vendor made it into the slides and the notes; in the other, details
from a previous meeting did. Neither is visible in a render, which is why a gate is needed.
"""
import argparse, html, json, re, sys

# Words that betray the making of the deck rather than its content. Kept short on purpose:
# each one has produced a real leak. Extend per case with --extra, not here.
PROCESS_ES = ["brief", "alcance acordado", "lo que pediste", "nos pediste", "esta slide",
              "en esta lámina", "a continuación", "feedback", "pendiente de alcance",
              "la reunión pasada", "como comentaste", "el tablero"]
PROCESS_EN = ["this slide shows", "as requested", "you asked", "pending scope", "we added",
              "per your feedback", "as discussed", "the brief", "hand off to"]


def slide_texts(src):
    """Visible text per slide, numbered as the deck shows them."""
    secs = re.split(r'(?=<section\b[^>]*class="[^"]*\bslide\b)', src)[1:]
    out = []
    for s in secs:
        s = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.S)
        s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
        t = html.unescape(re.sub(r"<[^>]+>", " ", s))
        out.append(re.sub(r"\s+", " ", t).strip())
    return out


def speaker_notes(src):
    m = re.search(r'<script[^>]*id="speaker-notes"[^>]*>(.*?)</script>', src, re.S)
    if not m:
        return []
    try:
        notes = json.loads(m.group(1))
        return [str(n) for n in notes] if isinstance(notes, list) else []
    except json.JSONDecodeError:
        return [m.group(1)]


def scan(label, texts, needles):
    hits = []
    for i, t in enumerate(texts, 1):
        low = t.lower()
        for n in needles:
            for m in re.finditer(r"(?<!\w)" + re.escape(n.lower()) + r"(?!\w)", low):
                a, b = max(0, m.start() - 45), min(len(t), m.end() + 45)
                hits.append((label, i, n, "…" + t[a:b] + "…"))
    return hits


def main():
    ap = argparse.ArgumentParser(description="Fail if briefing context leaks into a deck.")
    ap.add_argument("html")
    ap.add_argument("--names", help="names.txt from the case folder, one name per line")
    ap.add_argument("--extra", help="extra process words for this case, comma-separated")
    ap.add_argument("--allow", help="process words that ARE legitimate in this deck, comma-separated "
                    "(a proposal may say 'brief'); record why in the changelog")
    ap.add_argument("--notes-only", action="store_true")
    a = ap.parse_args()

    src = open(a.html, encoding="utf-8").read()
    names = []
    if a.names:
        names = [l.strip() for l in open(a.names, encoding="utf-8")
                 if l.strip() and not l.startswith("#")]
    process = PROCESS_ES + PROCESS_EN + [w.strip() for w in (a.extra or "").split(",") if w.strip()]
    allow = {w.strip().lower() for w in (a.allow or "").split(",") if w.strip()}
    process = [w for w in process if w.lower() not in allow]

    hits = []
    if not a.notes_only:
        slides = slide_texts(src)
        hits += scan("slide", slides, names + process)
    hits += scan("nota", speaker_notes(src), names + process)

    if not hits:
        print(f"limpio: {len(names)} nombres y {len(process)} palabras de proceso, sin coincidencias")
        return
    print(f"FUGA DE CONTEXTO: {len(hits)} coincidencias\n")
    for kind, n, needle, ctx in hits:
        print(f"  {kind} {n:02d}  «{needle}»  {ctx}")
    print("\nQuita cada una. Si una es legítima en este deck, pásala con --allow (o sácala de names.txt)"
          " y anota la razón en el changelog.")
    sys.exit(1)


if __name__ == "__main__":
    main()
