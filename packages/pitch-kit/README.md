# Noisia Pitch Kit

Make on-brand Noisia pitch decks — **PDF and editable PPTX** — from a shared engine and a
growing library of reusable slides, with a bridge to live Signal insights. Built for the
commercial team using Codex / Claude Code.

**Start here:** read `CANON.md` — the contract for the whole system (families, source hierarchy,
hard rules, where everything lives). Then invoke the skill `.claude/skills/noisia-pitch/SKILL.md`
(or just ask your agent to "armar un pitch para <cliente>"). Editing the kit itself? Read
`AGENTS.md`. Starting a run from a blank chat? Copy the prompt in `PROMPTS.md`.

## Layout
```
engine/      brand engine: noisia-tokens.css, deck.css, deck-stage.js, deck-template.html
slides/      reusable slide templates + catalog.json (the index of what's available)
builders/    build-pdf.mjs (→ PDF, needs Chrome) · build-pptx.py (→ editable PPTX, needs python-pptx) · build-portable.mjs (→ ONE self-contained .html; no repo/Node needed to view+print) · qa-render.py (→ renders every slide, flags overflow, builds contact sheets)
signal/      fetch-insights.mjs (pull metrics/quotes from the Signal public API)
assets/      brand logos / backgrounds / icons.json (95 Iconoir glyphs + 6 Simple Icons, already extracted)
templates/   PROVENANCE_AND_CHANGELOG.md + GUION_POR_SLIDE.md, copied into each working folder
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

## The rulebooks
`CANON.md` is the contract and the index; the rest are the layers it points to.

| File | Owns |
|---|---|
| `CANON.md` | Families, source hierarchy, cross-cutting rules, definition of done |
| `LAYOUTS.md` | Slide sequences, the cover, the framework slide, the method slide |
| `COPY_RULES.md` | Every word that shows on a slide |
| `ICONS.md` | Icons, platform marks, asset names, textures |
| `CHARTS.md` | Bars, lines, axes, platform colour, and the no-gradient rule |
| `METHODOLOGY.md` | What you may claim and how strongly |
| `DATA.md` | How the corpus is processed: ETL, quality gates, output contracts |
| `PROPOSALS.md` | Proposals and the product block |
| `PROMPTS.md` | The parameterized prompt that starts a run |

## Two principles
- **The repo is public → no client data here.** Templates only. Real decks — and each study's
  provenance record — stay in `examples/_local/` (gitignored).
- **The kit learns.** Build a new reusable slide → sanitize it → add to `slides/` + `catalog.json` → PR. Next teammate inherits it. See `AGENTS.md` → contribution loop.
