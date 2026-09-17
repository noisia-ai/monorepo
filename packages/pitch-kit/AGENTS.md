# AGENTS.md — packages/pitch-kit

The Noisia pitch system: a shared deck engine, a growing library of reusable slides,
builders for PDF + editable PPTX, and a bridge to Signal insights. The invocable skill is
`.claude/skills/noisia-pitch/SKILL.md` — read it for the build flow. This file is the
operative rulebook for anyone (human or agent) editing the kit itself.

**Before building a deck, also read `LEARNINGS.md`** — field-tested copy, terminology,
pricing and visual rules distilled from real client decks (política incluida).

## What's here
- `engine/` — `noisia-tokens.css` (brand palette/type), `deck.css` (slide layout), `deck-components.css` (reusable layout components: bars, split bars, tables, T&B matrix, kanban, mirror, verbatim cards…), `deck-stage.js` (16:9 viewer + print→PDF + PPTX capture), `deck-template.html` (shell). **Single source of truth** — decks copy these, they don't fork them.
- `CANON.md` — the contract for the whole system: the five deliverable families, the source hierarchy when two docs disagree, the cross-cutting hard rules, and the kit's own backlog. Start here, and keep it current: **a new handoff document is never the answer.** If you learned something reusable it belongs in the rulebook that owns that layer, referenced from the canon.
- `COPY_RULES.md` · `ICONS.md` · `LAYOUTS.md` · `CHARTS.md` — the word / icon / layout / chart rulebooks every deck passes through.
- `LEARNINGS.md` — the field record: what real client feedback taught us about copy, MX political terminology, pricing shape, icons and render gotchas. It is a log, not a rulebook: when a learning hardens into a rule it moves into the rulebook that owns it and stays here as the note of where it came from.
- `DATA.md` — the execution manual for a corpus: inventory, streaming ETL, quality gates, output contracts. `PROPOSALS.md` — the commercial family. `PROMPTS.md` — the entry-point prompt. `templates/` — provenance and script, copied into each working folder.
- `METHODOLOGY.md` — the fourth rulebook: how a study gets its content (sourcing/LQL, streaming ETL, data reality checks, T&B tagging, and the per-study provenance + changelog record). Design rulebooks say how a deck *looks*; this one says how it *earns its truth*.
- `slides/` — reusable slide templates + `catalog.json` (the machine-readable index agents read).
- `builders/` — `build-pdf.mjs` (headless Chrome → PDF, no npm dep), `build-pptx.py` (python-pptx → editable PPTX), `qa-render.py` (renders every slide, flags edge overflow, builds contact sheets).
- `signal/` — `fetch-insights.mjs` (pulls metrics/quotes from the Signal public reporting API).
- `assets/` — brand logos/backgrounds, and `icons.json` with the Iconoir and Simple Icons glyphs already extracted, so no deck installs npm packages to draw an icon. `examples/` — sanitized demo decks only.

## Rules
1. **The repo is PUBLIC. No client data here — ever.** No client names, real numbers, findings, or third-party logos. Real decks live in a local working folder (or `examples/_local/`, gitignored). Templates are generic with `{{PLACEHOLDER}}`s.
2. **Content comes from `packages/kb`.** Positioning, methodology definitions and principles are canon there — reference, don't restate or contradict.
3. **Signal numbers are deterministic.** Metrics fetched via `signal/fetch-insights.mjs` are used as-is; never hand-edit a number. Keep every quote's source.
4. **The kit must learn.** When you build something reusable, contribute it back (see below). When you only consume existing slides, don't.
5. **Brand fidelity.** Use the tokens in `engine/noisia-tokens.css`; don't introduce off-palette colors or fonts. Canvas is 1920×1080.
6. **Copy passes `COPY_RULES.md`.** Humanize + client-ready sanitize every word: no internal/purpose/navigation text on a slide (the header-right is always `noisia.ai`), no AI tells, no emojis; in Spanish keep standard tech anglicisms (**Dashboard**, not "Panel de control"). Noisia is complex; the press is simple.
7. **The offer is Reportes / Estudios** (Data is a capability, not a third column). The catalog — R1-R3 and E1-E5 — lives in `packages/kb/02-services/product-model.md`; use those names. Foundation/Intelligence/Strategy are internal calibration of depth, **not** the commercial story: they don't belong on a slide. If the real work doesn't fit a catalog product, propose a custom scope honestly.
8. **Sell the question, not the method.** Never put a methodology name on a slide — use the question it answers. The method is for when the client asks how.
9. **Never write the SLIDES marker sequence inside an HTML comment** in `deck-template.html` or a fragment. An HTML comment ends at its first closing marker, so everything after it renders as visible text on the deck. This bit us once already.
10. **The engine is linked, not inlined.** A deck links `noisia-tokens.css`, `deck.css` and `deck-components.css`, in that order, and its own `<style>` block covers only what is specific to that deck. Redefining a component class inline is how the kit quietly stops being shared. If an inline class shows up in a second deck, promote it (contribution loop below).
11. **Icons are real, layouts are canonical.** Every glyph comes from Iconoir (semantic) or Simple Icons (brands) — never hand-drawn (`ICONS.md`). Build reports/studies from the two canonical shapes and shared components (`LAYOUTS.md` + `engine/deck-components.css`), don't re-invent structure or CSS per deck.

## 🔁 Contribution loop (how the kit grows)
When you create a reusable slide / rule / builder improvement:
1. **Sanitize** — strip all client specifics down to a generic template.
2. **Add** the fragment at `slides/<id>/<id>.html`.
3. **Register** it in `slides/catalog.json` (id, name, file, category, `when`, variants, placeholders, plus `height` and `fits_with`: what the slide occupies and what else fits with it. Measure them once so the next person does not discover them by rendering). A missing or stale catalog entry is the only real bug here — the catalog is how the next agent discovers your slide.
4. **PR it** (branch → PR, CI green). Additions under `slides/**` are exempt from Code-Owner review (see root `.github/CODEOWNERS`) so they land fast.

## Building a deck
See `.claude/skills/noisia-pitch/SKILL.md`. Short version: assemble `deck-template.html` + chosen `slides/*` fragments into a working `index.html`, fill placeholders, then `build-pdf.mjs` and/or `build-pptx.py`.

## Don't
- ❌ Fork `deck-stage.js`/tokens per deck (decks copy the shared engine, they don't diverge it).
- ❌ Add a slide fragment without a `catalog.json` entry.
- ❌ Commit a real client deck or any PII to this package.
