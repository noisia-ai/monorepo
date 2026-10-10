---
name: noisia-pitch
description: Build a Noisia sales/pitch deck (PDF and/or editable PPTX) from the shared slide library, brand engine, and knowledge base — and contribute new reusable slides back so the team's kit keeps growing. Use when asked to make a pitch, sales deck, presentation, propuesta, or "armar un deck" for a client.
---

# Noisia Pitch — build a deck, and make the kit smarter

You produce on-brand Noisia pitch decks and, crucially, **leave the kit better than you found it**: anything reusable you build gets contributed back so the next teammate inherits it.

Everything lives in `packages/pitch-kit/`. Read `packages/pitch-kit/AGENTS.md` for the full rules.

**Sales decks go to `packages/pitch-kit/commercial/`.** An opener, outbound opener, tailored
overview, commercial offer with prices, proposal or one-pager is built in native PPTX (editable in
Google Slides) with `commercial/builder/compose.py`, following `commercial/COMMERCIAL.md`. For
those decks that file overrides sections 1 and 2 below. The rest of this skill is for reports,
studies, samples and internal decks.

## 1. Know what you have (read these first)
- `packages/pitch-kit/CANON.md` — **the contract.** Which family you are building
  (reporte, estudio, muestra, comercial, interno), which doc owns which rule, what the cross-cutting
  hard rules are, and the definition of done. Read it before deciding anything else. For a study,
  `packages/pitch-kit/DATA.md` is the execution manual for the corpus; for anything commercial,
  `packages/pitch-kit/commercial/COMMERCIAL.md`.
- `packages/pitch-kit/slides/recipes.json` — **deck blueprints for common asks** (explain a methodology, propose/quote a study). Each recipe tells you what to ASK, what KB to LOAD, and which slides to use. Check here first — most requests match a recipe.
- `packages/pitch-kit/slides/catalog.json` — **the index of every available slide**. How you know what's possible. Read it before proposing a structure.
- `packages/kb/` — the Knowledge Base (methodologies, services, pricing, process, cases). **The content of a Noisia pitch comes from here — don't invent it.** Always load `00-overview/principles.md` **and `02-services/product-model.md`** (the offer is Reportes / Estudios / Data — the Foundation/Intelligence/Strategy tiers are internal calibration, not the sales structure); then the files the recipe lists.
- **Sell studies by the question, not the method.** (This is for selling. In a *delivered* study the frame slide IS titled with the method's name in English; see `COPY_RULES.md`.) Never name a methodology on a pitch slide — use the question it answers ("¿qué empuja la compra y qué la detiene?", not "Triggers & Barriers"). The method detail is for when the client asks how. See `product-model.md`.
- The **commercial KB lives in Google Drive**, not in this repo: pricing amounts, sales script, objections, client notes. If the deck needs those and you don't have the Drive folder in context, ask — don't invent a number and don't put currency amounts on a slide.
- `packages/pitch-kit/engine/` — the brand engine: `noisia-tokens.css` (palette/type), `deck.css` (slide layout), `deck-stage.js` (16:9 viewer + print/PPTX), `deck-template.html` (the shell).

## 2. Build the deck
1. **Match a recipe** in `recipes.json` and **ask its qualifying questions before building.** Don't guess the answers — they change the deck:
   - *Explain-a-methodology* (e.g. Triggers & Barriers): which methodology, which audience/category for the examples. Load the methodology's KB file; the examples (e.g. T&B's 4 layers with trigger+barrier) come from there, set in the client's category.
   - *Report proposal* (`report-proposal`): is it **R1** (their brand), **R2** (brand + competitors) or **R3** (one campaign)? Who are the real competitors (2–4; more dilutes the read)? Which markets? Do they already own a listening tool — if yes they're a **better** prospect, not a worse one. Reports sell with a **3-month minimum**: month one builds the baseline, and without a prior period the report can't say what changed.
   - *Study proposal* (`study-proposal`): which of the five decision moments — **E1 lanzar, E2 entrar, E3 defender, E4 optimizar, E5 innovar**? How many brands/competitors and markets (each extra market is ~+80%)? Sources and time window? Tight deadline?
   - Both: the **growth-ladder slide is obligatory** — it now reads Workshop → Reporte → Estudio → Estudios recurrentes. If you see Foundation/Intelligence/Strategy on a deck, it's stale. And **never put currency amounts on a slide** (pricing-logic rule — show the logic and the modality, not numbers).
2. Pull the product's deliverables, timeline and **"qué NO incluye"** from the catalog in `packages/kb/02-services/product-model.md` + `pricing-logic.md` + `delivery-format.md` — keep them consistent across the study-scope, deliverables and timeline slides. Stating what's excluded is what prevents the scope fight in month two; don't drop it to look generous. Then order the slides from the recipe (or `catalog.json` for a custom deck).
3. Make a working folder **outside the repo** (or `packages/pitch-kit/examples/_local/`, which is gitignored) and assemble:
   - `cp packages/pitch-kit/engine/{noisia-tokens.css,deck.css,deck-components.css,deck-stage.js} <work>/` and link all three stylesheets in that order. Your deck's own `<style>` covers only what is specific to it: never redefine a component class (`CANON.md` §5.1).
   - `cp packages/pitch-kit/assets/logo_norm.svg <work>/`
   - Copy `engine/deck-template.html` to `<work>/index.html`, and paste the chosen slide fragments (from `slides/<id>/<id>.html`) where `<!-- SLIDES -->` is. Fill every `{{PLACEHOLDER}}` and fix each footer's `NN / TOTAL`.
4. Render:
   - **PDF:** `node packages/pitch-kit/builders/build-pdf.mjs <work>/index.html <work>/deck.pdf`
   - **PPTX (editable):** write a `deck.json` (shape in `builders/build-pptx.py` header) then `python3 packages/pitch-kit/builders/build-pptx.py <work>/deck.json <work>/deck.pptx`
   - **Portable single file (no-clone / for a non-technical teammate):** `node packages/pitch-kit/builders/build-portable.mjs <work>/index.html <work>/deck.portable.html` — inlines the whole engine (CSS + JS as base64 + logo as data URI) into ONE `.html`. The teammate opens it in Chrome → Print → Save as PDF, with no repo, no Node, no server. Same 1920×1080 output.
5. Verify: render each slide at 1920×1080 and **look at it**, then open the PDF page by page. No overflow, footers numbered, no `{{PLACEHOLDER}}` left, and `grep -c '—' index.html` returns `0`. The full list is `CANON.md` §8.

## 2.5 Humanize + client-ready sanitize (mandatory — before you render)
**Run every word through `packages/pitch-kit/COPY_RULES.md`.** Non-negotiable:
- **Client-ready:** strip anything internal — slide purpose/navigation text (the header-right is `noisia.ai` or a short section label, never "cómo crecemos juntos"; the footer-left is always `noisia · social intelligence architects`), `{{placeholders}}`, comments, process notes, emojis. The client sees only their message.
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

If yes, **do not edit the kit from the session that built the deck.** Several sessions run at once
and two of them writing the same rulebook overwrite each other without warning. Instead:

1. **Write it down in the case folder**, in `CAMBIOS_PROPUESTOS_AL_PITCH_KIT.md`, from
   `packages/pitch-kit/templates/`: what the kit says today, what happened, what you propose, where.
2. **Mark which of your decisions were exceptions for this case**, so nobody turns them into a rule.
3. **Stop.** One session, the one the user asks to integrate, verifies it against the repo and folds
   it in. The full protocol is in `packages/pitch-kit/AGENTS.md`.

When the user does ask you to integrate (into the kit itself):
1. Run `git status` first. If there are changes you did not make, stop and ask.
2. **Sanitize.** Strip ALL client data, names, real numbers, and findings to a generic template with `{{PLACEHOLDER}}`s (the repo is public).
3. **Add** the fragment under `packages/pitch-kit/slides/<new-id>/<new-id>.html` and **register** it in `slides/catalog.json`, with `height` and `fits_with`.
4. **Commit before you finish**, on a short branch cut from an up-to-date `main`, and open a PR (CI must pass). Once it merges, the branch is deleted. Never leave the tree dirty.

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
