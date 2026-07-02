# AGENTS.md — packages/pitch-kit

The Noisia pitch system: a shared deck engine, a growing library of reusable slides,
builders for PDF + editable PPTX, and a bridge to Signal insights. The invocable skill is
`.claude/skills/noisia-pitch/SKILL.md` — read it for the build flow. This file is the
operative rulebook for anyone (human or agent) editing the kit itself.

**Before building a deck, also read `LEARNINGS.md`** — field-tested copy, terminology,
pricing and visual rules distilled from real client decks (política incluida).

## What's here
- `engine/` — `noisia-tokens.css` (brand palette/type), `deck.css` (slide layout), `deck-stage.js` (16:9 viewer + print→PDF + PPTX capture), `deck-template.html` (shell). **Single source of truth** — decks copy these, they don't fork them.
- `slides/` — reusable slide templates + `catalog.json` (the machine-readable index agents read).
- `builders/` — `build-pdf.mjs` (headless Chrome → PDF, no npm dep), `build-pptx.py` (python-pptx → editable PPTX).
- `signal/` — `fetch-insights.mjs` (pulls metrics/quotes from the Signal public reporting API).
- `assets/` — brand logos/backgrounds. `examples/` — sanitized demo decks only.
- `COPY_RULES.md` — every word passes through it. `LEARNINGS.md` — field-tested rules (copy, terminología política MX, pricing, iconografía, caveats).

## Rules
1. **The repo is PUBLIC. No client data here — ever.** No client names, real numbers, findings, or third-party logos. Real decks live in a local working folder (or `examples/_local/`, gitignored). Templates are generic with `{{PLACEHOLDER}}`s.
2. **Content comes from `packages/kb`.** Positioning, methodology definitions and principles are canon there — reference, don't restate or contradict.
3. **Signal numbers are deterministic.** Metrics fetched via `signal/fetch-insights.mjs` are used as-is; never hand-edit a number. Keep every quote's source.
4. **The kit must learn.** When you build something reusable, contribute it back (see below). When you only consume existing slides, don't.
5. **Brand fidelity.** Use the tokens in `engine/noisia-tokens.css`; don't introduce off-palette colors or fonts. Canvas is 1920×1080.
6. **Copy passes `COPY_RULES.md`.** Humanize + client-ready sanitize every word: no internal/purpose/navigation text on a slide (the header-right is always `noisia.ai`), no AI tells, no emojis; in Spanish keep standard tech anglicisms (**Dashboard**, not "Panel de control"). Noisia is complex; the press is simple.
7. **Tiers are a reference, not a cage.** Foundation/Intelligence/Strategy guide scoping and pricing — propose a custom scope when the real work doesn't fit a tier.

## 🔁 Contribution loop (how the kit grows)
When you create a reusable slide / rule / builder improvement:
1. **Sanitize** — strip all client specifics down to a generic template.
2. **Add** the fragment at `slides/<id>/<id>.html`.
3. **Register** it in `slides/catalog.json` (id, name, file, category, `when`, variants, placeholders). A missing or stale catalog entry is the only real bug here — the catalog is how the next agent discovers your slide.
4. **PR it** (branch → PR, CI green). Additions under `slides/**` are exempt from Code-Owner review (see root `.github/CODEOWNERS`) so they land fast.

## Building a deck
See `.claude/skills/noisia-pitch/SKILL.md`. Short version: assemble `deck-template.html` + chosen `slides/*` fragments into a working `index.html`, fill placeholders, then `build-pdf.mjs` and/or `build-pptx.py`.

## Don't
- ❌ Fork `deck-stage.js`/tokens per deck (decks copy the shared engine, they don't diverge it).
- ❌ Add a slide fragment without a `catalog.json` entry.
- ❌ Commit a real client deck or any PII to this package.
