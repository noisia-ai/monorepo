#!/usr/bin/env python3
"""
compose.py — brief in, finished deck out.

    python3 compose.py brief.json out.pptx [--pdf] [--spec-out spec.json]

The brief is the only thing the agent writes. It holds the interview answers and the
client-specific slides; everything else comes from copy/<lang>.json, verbatim. That split is
the point: the commercial team's approved copy is reused word for word, and the agent only
writes what is genuinely about this client.

    {
      "deliverable": "opener | outbound | overview | offer | proposal | onepager",
      "lang": "es | en",
      "mode": "present | send",
      "vars": {"CLIENTE": "...", "MERCADO": "México", "FECHA": "Octubre 2026",
               "MONEDA": "USD", "IMPUESTOS": "más impuestos", "FIRMA": "...", "EMAIL": "..."},
      "client_logo": "logo.png",            # optional; otherwise a replaceable slot
      "include": ["sample", "engine"],      # optional modules to switch on
      "exclude": ["coverage"],              # recipe modules to drop
      "slides": {"questions_client": {...}, "statement_punch": {...}}
    }

`slides.<module>` is merged over the canonical module: keys you give replace the canonical
ones, keys you leave out keep the canonical copy, and lists of cards merge card by card. A module marked client:true in the copy file
has to be given here, or the build stops and says which.
"""
import copy, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import build_deck  # noqa: E402


def merge(base, over):
    """Dicts merge by key. Lists of objects merge by position and the brief decides the
    length, so a brief can rewrite the text of a format card and keep its canonical name."""
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = merge(base.get(k), v) if k in base else v
        return out
    if isinstance(base, list) and isinstance(over, list) and over and all(isinstance(o, dict) for o in over) \
            and base and all(isinstance(b, dict) for b in base):
        return [merge(base[i], o) if i < len(base) else copy.deepcopy(o) for i, o in enumerate(over)]
    return copy.deepcopy(over)


def substitute(obj, vars_):
    if isinstance(obj, str):
        return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: str(vars_.get(m.group(1), m.group(0))), obj)
    if isinstance(obj, list):
        return [substitute(x, vars_) for x in obj]
    if isinstance(obj, dict):
        return {k: substitute(v, vars_) for k, v in obj.items()}
    return obj


def compose(brief):
    lang = brief.get("lang", "es")
    lib = json.load(open(os.path.join(ROOT, "copy", f"{lang}.json"), encoding="utf-8"))
    recipes = json.load(open(os.path.join(ROOT, "recipes.json"), encoding="utf-8"))
    deliv = brief["deliverable"]
    if deliv not in recipes or deliv.startswith("_"):
        sys.exit(f"entregable '{deliv}' no existe. Opciones: {', '.join(k for k in recipes if not k.startswith('_'))}")
    given = brief.get("slides", {})
    include, exclude = set(brief.get("include", [])), set(brief.get("exclude", []))
    missing, slides = [], []
    for entry in recipes[deliv]["slides"]:
        mod = entry if isinstance(entry, str) else entry["module"]
        optional = isinstance(entry, dict) and entry.get("optional")
        if mod in exclude or (optional and mod not in include and mod not in given):
            continue
        base = copy.deepcopy(lib[mod])
        needs_client = base.pop("client", False)
        if needs_client and mod not in given:
            missing.append(mod)
            continue
        sl = merge(base, given.get(mod, {}))
        if mod in ("cover_client", "onepager") and brief.get("client_logo"):
            sl["client_logo"] = brief["client_logo"]
        slides.append(sl)
    if missing:
        print("FALTAN slides del cliente en el brief (escríbelas con COMMERCIAL.md §4):")
        for m in missing:
            print("  ·", m)
        sys.exit(1)
    vars_ = dict(brief.get("vars", {}))
    spec = {"lang": lang, "mode": brief.get("mode", "send"),
            "header_right": brief.get("header_right", "noisia.ai"),
            "portrait": deliv == "onepager",
            "slides": substitute(slides, vars_)}
    return spec


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("uso: python3 compose.py brief.json out.pptx [--pdf] [--spec-out spec.json]")
    brief = json.load(open(sys.argv[1], encoding="utf-8"))
    spec = compose(brief)
    if "--spec-out" in sys.argv:
        json.dump(spec, open(sys.argv[sys.argv.index("--spec-out") + 1], "w"), ensure_ascii=False, indent=1)
    build_deck.build(spec, sys.argv[2], pdf="--pdf" in sys.argv)
