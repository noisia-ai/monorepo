# Noisia Pitch Kit

Make on-brand Noisia pitch decks — **PDF and editable PPTX** — from a shared engine and a
growing library of reusable slides, with a bridge to live Signal insights. Built for the
commercial team using Codex / Claude Code.

**Start here:** invoke the skill `.claude/skills/noisia-pitch/SKILL.md` (or just ask your
agent to "armar un pitch para <cliente>"). Editing the kit itself? Read `AGENTS.md`.

## Layout
```
engine/      brand engine: noisia-tokens.css, deck.css, deck-stage.js, deck-template.html
slides/      reusable slide templates + catalog.json (the index of what's available)
builders/    build-pdf.mjs (→ PDF, needs Chrome) · build-pptx.py (→ editable PPTX, needs python-pptx) · build-portable.mjs (→ ONE self-contained .html; no repo/Node needed to view+print)
signal/      fetch-insights.mjs (pull metrics/quotes from the Signal public API)
assets/      brand logos / backgrounds
examples/    sanitized demo decks only (examples/_local/ is gitignored for real work)
```

## Quick build
```bash
# 1. assemble a working deck (outside the repo, or in examples/_local/)
mkdir -p examples/_local/mydeck
cp engine/{noisia-tokens.css,deck.css,deck-stage.js} assets/logo_norm.svg examples/_local/mydeck/
cp engine/deck-template.html examples/_local/mydeck/index.html
#   → paste slide fragments from slides/<id>/<id>.html into index.html, fill {{PLACEHOLDERS}}

# 2a. PDF
node builders/build-pdf.mjs examples/_local/mydeck/index.html examples/_local/mydeck/deck.pdf

# 2b. editable PPTX  (pip install python-pptx)
python3 builders/build-pptx.py examples/_local/mydeck/deck.json examples/_local/mydeck/deck.pptx
```

## Two principles
- **The repo is public → no client data here.** Templates only. Real decks stay local.
- **The kit learns.** Build a new reusable slide → sanitize it → add to `slides/` + `catalog.json` → PR. Next teammate inherits it. See `AGENTS.md` → contribution loop.
