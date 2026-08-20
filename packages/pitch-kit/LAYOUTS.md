# Layouts — the two canonical deck shapes (Reporte & Estudio)

> Proven slide sequences and components, extracted from the shipped Smart Speakers and Alexa+ decks. Build new reports/studies from these instead of inventing structure. Components live in `engine/deck-components.css` (load it after `noisia-tokens.css` + `deck.css`). Icons: see `ICONS.md`. Words: see `COPY_RULES.md`.

## Reporte vs Estudio (never blur them)

- **Reporte** = agnostic monthly monitor. Answers *"what's happening"* + a light interpretation layer. Starts from the data, not a question. Always compares vs. the prior period.
- **Estudio** = starts from a **research question / brief**. Answers *"why, and where to act."* Uses a methodology (Triggers & Barriers = 4 layers · psychological / personal / social / cultural × triggers/barriers; the brand can move psychological + personal fully, social partially, only *align* with cultural).

## Reporte — canonical sequence (~10 slides)

| # | Slide | Components |
|---|---|---|
| 1 | Cover | `cover` (eyebrow = subject, not "subcategory"; meta line under the sub) |
| 2 | The month at a glance | `.kpi` ×4 + `.irow` reads (continuity vs. prior) |
| 3 | Share of voice + channels | two equal-height `.vcard`s: `.bars` (SoV by brand) ‖ `.bars` (channels) |
| 4 | Sentiment by brand | `.sbrow`/`.split` (neg/pos among those with an opinion) + `.irow` "what's behind it" |
| 5 | What it argues about | `.tbl` topics (theme · lean `.tag` · loudest-for · `.mini` share · trend) |
| 6 | Head-to-head | `.hh` cards ×4 (match-up + claim + one verbatim) |
| 7 | Evidence | `.vq` verbatims, real + link + source chip, split friction / pull |
| 8 | The read | `.slide.dark` statement + `.note` "and then what → study" |
| 9–10 | Glossary ×2 | `.gloss`/`.gterm` + channel `.chip`s |

## Estudio (Triggers & Barriers) — canonical sequence (~14 slides)

| # | Slide | Components |
|---|---|---|
| 1 | Cover | research question as the subject; cover illustration bleeding right |
| 2 | Brief | the question **is** the title + `.idx` index cards (no "a study starts from a question" meta) |
| 3 | The four layers | `assets/tb-map.png` behind (z-index:-1), push/pull labels, 4 layer cards |
| 4 | Hypothesis | the claim + a chart that *is* the proof (e.g. triggers & barriers rising together) |
| 5 | The map | `.mtx` 4×2 matrix (each pull with its shadow), counts + channel + sentiment dot |
| 6 | What it pulls in | `.barh` triggers + `.note` |
| 7 | Anatomy of the #1 pull | `.irow` (what it is / why it runs deep) + antropological `.card` + `.vq` |
| 8 | What it adds | `.barh` barriers (coral) + `.note` |
| 9 | Anatomy of the barrier that decides | mirror of slide 7, coral |
| 10 | The mirror | `.mir` rows (every pull ↔ its shadow) + `.note` |
| 11 | Where a brand can act | `.kan` kanban (act here / partial / align only) |
| 12 | The answer | `.slide.dark` — answers the question + `.note` "the bet" |
| 13–14 | Glossary ×2–3 | T&B terms + methods + channel `.chip`s |

## Non-negotiables (both shapes)

- **Everything vs. the prior period.** No number stands alone.
- **Consolidated, equal-height cards** on the volume/channels slide (chart and bars aligned).
- **Verbatims are real**, pulled from the corpus, with a link to the post and a visible source (platform logo + date). Never invented.
- **No black cards.** Interpretation lives in a light `.note` (teal-soft) or a `.slide.dark` full-bleed statement — not a black callout box.
- **Soft bar gradients** (`#0d8a8a→#37b0ad`, coral `#d6492f→#e8735c`), never harsh cyan.
- **Icons everywhere**, and real (see `ICONS.md`).
- **`data-label` is navigation metadata**, never rendered copy.
