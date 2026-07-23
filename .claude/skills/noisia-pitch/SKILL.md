---
name: noisia-pitch
description: Build a Noisia sales/pitch deck (PDF and/or editable PPTX) from the shared slide library, brand engine, and knowledge base — and contribute new reusable slides back so the team's kit keeps growing. Use when asked to make a pitch, sales deck, presentation, propuesta, or "armar un deck" for a client.
---

# Noisia Pitch — build a deck, and make the kit smarter

You produce on-brand Noisia pitch decks and, crucially, **leave the kit better than you found it**: anything reusable you build gets contributed back so the next teammate inherits it.

Everything lives in `packages/pitch-kit/`. Read `packages/pitch-kit/AGENTS.md` for the full rules.

## 1. Know what you have (read these first)
- `packages/pitch-kit/slides/recipes.json` — **deck blueprints for common asks** (explain a methodology, propose/quote a study). Each recipe tells you what to ASK, what KB to LOAD, and which slides to use. Check here first — most requests match a recipe.
- `packages/pitch-kit/slides/catalog.json` — **the index of every available slide**. How you know what's possible. Read it before proposing a structure.
- `packages/kb/` — the Knowledge Base (methodologies, services, pricing, process, cases). **The content of a Noisia pitch comes from here — don't invent it.** Always load `00-overview/principles.md` **and `02-services/product-model.md`** (the offer is Reportes / Estudios / Data — the Foundation/Intelligence/Strategy tiers are internal calibration, not the sales structure); then the files the recipe lists.
- **Sell studies by the question, not the method.** Never name a methodology on a pitch slide — use the question it answers ("¿qué empuja la compra y qué la detiene?", not "Triggers & Barriers"). The method detail is for when the client asks how. See `product-model.md`.
- The **commercial KB lives in Google Drive**, not in this repo: pricing amounts, sales script, objections, client notes. If the deck needs those and you don't have the Drive folder in context, ask — don't invent a number and don't put currency amounts on a slide.
- `packages/pitch-kit/engine/` — the brand engine: `noisia-tokens.css` (palette/type), `deck.css` (slide layout), `deck-stage.js` (16:9 viewer + print/PPTX), `deck-template.html` (the shell).

## 2. Build the deck
1. **Match a recipe** in `recipes.json` and **ask its qualifying questions before building.** Don't guess the answers — they change the deck:
   - *Explain-a-methodology* (e.g. Triggers & Barriers): which methodology, which audience/category for the examples. Load the methodology's KB file; the examples (e.g. T&B's 4 layers with trigger+barrier) come from there, set in the client's category.
   - *Study proposal / quote*: **is it a single project or a monthly retainer?** how many brands/competitors? how many markets? which sources & time window? any tight deadline? These set the tier (Foundation/Intelligence/Strategy) and the whole quote. The **growth-ladder slide ("cómo crecemos el negocio") is obligatory** in proposals, and **never put currency amounts on a slide** (pricing-logic rule — show the logic + modality, not numbers). The tiers **Foundation / Intelligence / Strategy are a reference, not a cage** — if the real scope doesn't fit a tier, propose a custom scope honestly instead of forcing the project into one.
2. Pull deliverables, timeline and tier facts from `packages/kb/02-services/<tier>.md` + `pricing-logic.md` + `delivery-format.md` — keep them consistent across the study-scope, deliverables and timeline slides. Then order the slides from the recipe (or `catalog.json` for a custom deck).
3. Make a working folder **outside the repo** (or `packages/pitch-kit/examples/_local/`, which is gitignored) and assemble:
   - `cp packages/pitch-kit/engine/{noisia-tokens.css,deck.css,deck-stage.js} <work>/`
   - `cp packages/pitch-kit/assets/logo_norm.svg <work>/`
   - Copy `engine/deck-template.html` to `<work>/index.html`, and paste the chosen slide fragments (from `slides/<id>/<id>.html`) where `<!-- SLIDES -->` is. Fill every `{{PLACEHOLDER}}` and fix each footer's `NN / TOTAL`.
4. Render:
   - **PDF:** `node packages/pitch-kit/builders/build-pdf.mjs <work>/index.html <work>/deck.pdf`
   - **PPTX (editable):** write a `deck.json` (shape in `builders/build-pptx.py` header) then `python3 packages/pitch-kit/builders/build-pptx.py <work>/deck.json <work>/deck.pptx`
5. Verify: open the PDF; every slide is 1920×1080, no overflow, footers numbered, no `{{PLACEHOLDER}}` left.

## 2.5 Humanize + client-ready sanitize (mandatory — before you render)
**Run every word through `packages/pitch-kit/COPY_RULES.md`.** Non-negotiable:
- **Client-ready:** strip anything internal — slide purpose/navigation text (the header is always `noisia.ai`, never "cómo crecemos juntos"), `{{placeholders}}`, comments, process notes, emojis. The client sees only their message.
- **Humanize:** kill AI tells (additionally/crucial/leverage/"se posiciona como"/inflated significance/rule-of-three/em-dash & bold spam). Simple over sophisticated — Noisia is complex, the press isn't.
- **Spanish decks:** don't translate standard tech anglicisms — it's **Dashboard**, not "Panel de control"; keep insight, brief, performance, corpus, trigger. Use the client's own category terms.

## 3. Pull insights from Signal (optional)
To put real numbers/quotes on a `signal-insight` or `finding` slide:
```
SIGNAL_API_BASE=<studio-host> SIGNAL_API_TOKEN=<token> \
  node packages/pitch-kit/signal/fetch-insights.mjs <outputId> <work>/insights.json
```
Use the returned metrics **as-is** (Signal computes them deterministically — never edit a number) and keep each quote's source for traceability.

## 4. 🔁 Contribute back — this is the point
The kit only stays useful if it grows. **Before you finish a deck, ask yourself: did I build something reusable that the kit didn't have?** (A new slide type — e.g. legal/pricing/roadmap — a new rule, a builder fix, a better default.)

If yes:
1. **Sanitize it.** Strip ALL client data, names, real numbers, and findings. Reduce it to a generic template with `{{PLACEHOLDER}}`s. (See the confidentiality rule below — this is non-negotiable on a public repo.)
2. **Add the fragment** under `packages/pitch-kit/slides/<new-id>/<new-id>.html`.
3. **Register it** in `packages/pitch-kit/slides/catalog.json` (id, name, file, category, `when`, variants, placeholders).
4. **Open a PR** (branch → PR; CI must pass). Slide additions under `slides/**` are exempt from Code-Owner review, so they merge fast.
5. In the PR body, one line: what the slide is and when to use it.

Next time anyone runs this skill, `catalog.json` already lists your slide. That's how "the slides legales someone asked for" stop getting lost.

> If you only *used* existing slides and learned nothing reusable, you don't need to contribute — don't invent churn.

## 5. 🔒 Confidentiality (hard rule — the repo is PUBLIC)
- **Never commit client data** (names, numbers, findings, logos you don't own) to `packages/pitch-kit/`. The real client deck lives in your local working folder only.
- Contributions back are **generic templates only**. When in doubt, leave it out.
- CI runs a secret scan; don't rely on it — sanitize yourself.

## 6. Done checklist
- [ ] Deck rendered (PDF and/or PPTX), no leftover placeholders, footers numbered.
- [ ] **Copy passed `COPY_RULES.md`:** no internal/purpose/nav text, no AI tells, anglicisms kept (Dashboard not "Panel de control"), read once as the client.
- [ ] Claims sourced from `packages/kb` + (if used) Signal numbers unedited.
- [ ] Tiers used as reference, not forced; growth-ladder present if it's a proposal.
- [ ] No client data anywhere under `packages/pitch-kit/`.
- [ ] If I built something reusable → sanitized template + catalog entry + PR.
