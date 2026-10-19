#!/usr/bin/env python3
"""
check-queries.py — validate listening queries before anyone pastes them into the tool.

    python3 builders/check-queries.py queries.md [--no-accents]

Reads every fenced code block of the file as one query (the format DATA.md §3 asks for: one
final query per block, ready to paste) and checks what has broken real queries:

  · parentheses balanced and quotes paired, outside and inside quoted phrases;
  · wildcards only at the end of a word, with a prefix of 4 or more letters, and no `?`;
  · no operator the tool does not parse: NEAR or any proximity, field operators (title:,
    author:, site:, subreddit:, url:, engagingWith:), `-(` for negation (write NOT);
    `rawText:` is allowed, it is how Advanced Query demands the subject in the post's own text;
  · no em or en dash;
  · every accented term has its unaccented twin in the same query, since LQL does not document
    accent folding (METHODOLOGY.md §1). --no-accents skips this when the tool is known to fold.

It does not judge whether a query is good, only whether it is well formed. Exit code 1 when
anything fails, so a script that generates queries can call it last.
"""
import re, sys, unicodedata

FIELDS = ("title", "author", "site", "subreddit", "url", "engagingwith")


def strip_accents(t):
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")


def blocks(md):
    out, cur, inside, name = [], [], False, None
    last_heading = None
    for line in md.splitlines():
        if line.startswith("#"):
            last_heading = line.lstrip("#").strip()
        if line.strip().startswith("```"):
            if inside:
                out.append((name or f"bloque {len(out) + 1}", "\n".join(cur)))
                cur, inside = [], False
            else:
                inside, name = True, last_heading
            continue
        if inside:
            cur.append(line)
    return out


def check(q, accents=True):
    errs = []
    if q.count('"') % 2:
        errs.append("comillas sin pareja")
    depth = 0
    outside = re.sub(r'"[^"]*"', '""', q)
    for ch in outside:
        depth += ch == "("
        depth -= ch == ")"
        if depth < 0:
            errs.append("un ')' cierra antes de abrir")
            break
    if depth > 0:
        errs.append(f"faltan {depth} ')' por cerrar")
    if re.search(r"\bNEAR\b|~\d|\bW/\d", outside, re.I):
        errs.append("operador de proximidad (NEAR o ~N): la herramienta no lo soporta")
    for f in FIELDS:
        if re.search(rf"\b{f}:", outside, re.I):
            errs.append(f"operador de campo '{f}:' no se parsea")
    if re.search(r"(^|\s)-\(", outside):
        errs.append("negación con '-(': escribe NOT (...)")
    if "?" in outside:
        errs.append("comodín '?' de un carácter: expándelo a mano")
    for m in re.finditer(r"[\wÀ-ɏ]*\*[\wÀ-ɏ]*", q):
        tok = m.group(0)
        if not tok.endswith("*") or tok.count("*") > 1:
            errs.append(f"comodín fuera del final: «{tok}»")
        elif len(tok) - 1 < 4:
            errs.append(f"comodín con prefijo de menos de 4 letras: «{tok}»")
    if "—" in q or "–" in q:
        errs.append("em dash o en dash")
    if accents:
        terms = re.findall(r'"[^"]+"|[\wÀ-ɏ*]+', q)
        plain = {strip_accents(t).lower() for t in terms if t == strip_accents(t)}
        stems = [t[:-1].lower() for t in plain if t.endswith("*")]
        for t in terms:
            bare = strip_accents(t).lower()
            covered = bare in plain or any(bare.strip('"').startswith(st) for st in stems)
            if t != strip_accents(t) and not covered:
                errs.append(f"sin gemelo sin acento: {t} (agrega {strip_accents(t)})")
    return sorted(set(errs), key=errs.index)


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: python3 builders/check-queries.py queries.md [--no-accents]")
    bl = blocks(open(sys.argv[1], encoding="utf-8").read())
    if not bl:
        sys.exit("No encontré bloques de código: cada query va en su propio bloque ```.")
    bad = 0
    for name, q in bl:
        errs = check(q, accents="--no-accents" not in sys.argv)
        if errs:
            bad += 1
            print(f"✗ {name}")
            for e in errs:
                print("   ·", e)
        else:
            print(f"✓ {name}")
    print(f"\n{len(bl)} queries, {bad} con problemas")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
