# Layouts — the canonical deck shapes

> Proven slide sequences and components, extracted from the shipped decks. Build new work from
> these instead of inventing structure. The contract that governs all of them is `CANON.md`;
> components live in `engine/deck-components.css`; icons in `ICONS.md`; words in `COPY_RULES.md`.

## Wiring (before anything else)

Every deck links the engine in this order and does not fork it:

```html
<link rel="stylesheet" href="noisia-tokens.css">
<link rel="stylesheet" href="deck.css">
<link rel="stylesheet" href="deck-components.css">
<style> /* only what is specific to THIS deck */ </style>
```

`deck-components.css` is the reason the kit exists. If your inline `<style>` redefines `.note`,
`.kpi`, `.vq`, `.barh`, `.mtx`, `.kan`, `.mir`, `.gloss` or any other component class, delete it
and use the component. If a class in your inline block shows up in a second deck, promote it to
the engine (`AGENTS.md` → contribution loop).

Assets keep one canonical name each: `assets/tb-map.png`, `assets/cover-illustration.png`,
`assets/logo_norm.svg`.

## The five families

`CANON.md` §3 owns the family decision. This file owns the sequences for **Reporte**, **Estudio**
and **Muestra**; `PROPOSALS.md` owns **Propuesta** and the **Producto** block.

- **Reporte** = agnostic monthly monitor. Answers *"what's happening"* + a light interpretation
  layer. Starts from the data, not a question. Always compares vs. the prior period.
- **Estudio** = starts from a **research question / brief**. Answers *"why, and where to act."*
  Uses a methodology (Triggers & Barriers = 4 layers · psychological / personal / social /
  cultural × triggers/barriers; the brand can move psychological + personal fully, social
  partially, only *align* with cultural).
- **Muestra** = a study with a deliberately narrow scope, used to show the quality of the read.
  Stops at the diagnosis.

Never blur a reporte and an estudio.

## The cover (all families)

Every shipped deck converged on the same cover, so it is canon now. Full-bleed illustration on the
right, copy anchored bottom-left:

| Element | Rule |
|---|---|
| Header left | `logo_norm.svg` |
| Header right | market and year (`México · 2026`), or the subject. Never the deck type |
| Illustration | `assets/cover-illustration.png`, bleeding off the right edge (`right:-110px`, `height:113%`), behind the copy (`z-index:0`). The slide carries `atmos plain`: the engine's cyan blob over the art reads as a heavy wash, and the cover keeps only the illustration's own gradient |
| Eyebrow | a short chip on `--teal-soft`: what kind of read this is |
| Title | the research question, 77–88px, one accent word in `--teal`. Not the document type |
| Subhead | 25–26px, one sentence: what the deck answers and for whom |
| Meta line | subject · market · period, 18–19px, secondary color |
| Footer | `noisia · social intelligence architects` and `01 / TOTAL` |

Use the `.cover-art` / `.cover-copy` classes from `deck-components.css` rather than repeating the
inline positioning, and start from the `slides/cover-study` fragment.

## Reporte — canonical sequence (~10 slides)

| # | Slide | Components |
|---|---|---|
| 1 | Cover | `slides/cover-study` — cover spec above (eyebrow = subject, not "subcategory") |
| 2 | The month at a glance | `.kpi` ×4 + `.irow` reads (continuity vs. prior) |
| 3 | Share of voice + channels | two equal-height `.vcard`s: `.bars` (SoV by brand) ‖ `.bars` (channels) |
| 4 | Sentiment by brand | `.sbrow`/`.split` (neg/pos among those with an opinion) + `.irow` "what's behind it" |
| 5 | What it argues about | `.tbl` topics (theme · lean `.tag` · loudest-for · `.mini` share · trend) |
| 6 | Head-to-head | `.hh` cards ×4 (match-up + claim + one verbatim). **R2 only**: a single-brand report (R1) drops this slide and lands at 9 |
| 7 | Evidence | `.vq` verbatims, real + link + source chip, split friction / pull |
| 8 | The read | `.slide.dark` statement + `.note` "and then what → study" |
| 9–10 | Glossary ×2 | `.gloss`/`.gterm` + channel `.chip`s |

## Estudio (Triggers & Barriers) — canonical sequence (14–18 slides)

| # | Slide | Components |
|---|---|---|
| 1 | Cover | `slides/cover-study` — cover spec above; research question as the subject |
| 2 | Brief | the question **is** the title + `.idx` index cards (no "a study starts from a question" meta) |
| 3 | The four layers | `slides/tb-layers` — the framework slide, see spec below |
| 4 | Hypothesis | the claim + a chart that *is* the proof (e.g. triggers & barriers rising together) |
| 5 | Where the conversation lives | `slides/channels` — `.roles` (channel mark + share + one-line role each) + `.note` for the odd-one-out |
| 6 | The map | `.mtx` 4×2 matrix (each pull with its shadow), counts + channel + sentiment dot |
| 7 | What it pulls in | `.barh` triggers + `.note` |
| 8 | Anatomy of the #1 pull | `.irow` (what it is / why it runs deep) + anthropological `.card` + `.vq` |
| 9 | What it adds | `.barh` barriers (coral) + `.note` |
| 10 | Anatomy of the barrier that decides | mirror of slide 8, coral |
| 11 | The mirror | `.mir` rows (every pull ↔ its shadow) + `.note` |
| 12 | Who they measure it against | optional, when the brief names rivals: who the subject is compared against today and who it will be compared against next. Plain cards, no matrix |
| 13 | Where a brand can act | `.kan` kanban (act here / partial / align only) |
| 14 | The answer | `.slide.dark` — answers the question + `.note` "the bet" |
| 15 | Method | `slides/method` — how it was read: scope, what was cut, what the numbers mean, see spec below |
| 16–18 | Glossary ×2–3 | see the scope-contract spec below |

Slides 5 and 15 used to be optional. The four most recent studies all shipped with them, so they
are part of the sequence now. A study that drops one should say why in its provenance record.
Slide 12 stays optional and depends on the brief: a category-agnostic study has no rival to name.

**Channels slide framing.** Clients ask for the channel split and it earns its place, but frame it
as *where people talk and what each platform is for*, never as "share of voice de la categoría".
That phrasing reveals the sell (`COPY_RULES.md` §0). Each channel's role has to be demonstrable
with verbatims from that channel, not assigned by platform stereotype (`DATA.md` §18).

### The framework slide (#3) — the one clients remember

The concentric-rings diagram sits **behind** the content and carries the whole explanation of the
method without naming it commercially:

- The whole geometry is the `.tbmap` component: `assets/tb-map.png` absolutely positioned,
  `width:1320px`, centered, `z-index:-1`, inside a `position:relative; height:560px` wrapper.
- Left label **Empuja (trigger)** in `--teal` (`.tl.pull`), right label **Frena (barrier)** in
  `--coral` (`.tl.shadow`), both at `top:250px`, 340px wide, the right one right-aligned.
- Under the map, four permission cards in a 4-column grid (`.lperm`): psychological and personal say a brand
  moves them, social says partial influence, cultural says align only. This is what makes slide 12
  land, so the wording of the four cards and of the kanban (slide 13) has to agree.
- The asset ships with its innermost ring reading `Psychological`, in English, and it stays that
  way in every deck regardless of language. Nothing is overlaid on the artwork (`ICONS.md`). The
  reader gets the word in their language from the `.lperm` cards right below.

**When the study uses a different frame** (a fast-moving public-affairs topic, a risk read, a
maturity model), keep the same slide *function* and swap the diagram for a 2×2 grid of framework
cards: the `.fwg` / `.fwc` components, each an `.icobox` + a `.tag` with the term + a
plain-language headline + two lines of what it means here. The rule is that the frame gets explained on its own slide, in human language, **before**
any slide uses it. Never introduce a frame and use it in the same breath.

### The method slide (#15) — traceability, client-safe

One slide, near the end, that makes the whole deck defensible. What goes on it:

- The size of the read, stated plainly (`2.4 millones de menciones, leídas por capas`).
- The period and the market.
- What was excluded as noise, and roughly how much.
- What the counts mean and what they do not (`.irow` rows work well here).
- A `.note` with the honest limit: which claims are exact and which are directional.

What never goes on it: tool names, query syntax, file names, scripts, or the word ETL. The detail
lives in `PROVENANCE_AND_CHANGELOG.md`. See `COPY_RULES.md` §0 and `CANON.md` §5.3 for whether
this deck shows raw counts or share of conversation.

### The glossaries are the scope contract, not filler

This is where each family declares what it measured and how far it goes, in the client's own
language. Reusing them is how two decks from different months stay comparable. Taken from the
shipped decks, the blocks are fixed:

**Shared by both families, always present:** *Qué medimos, y dónde.* Defines **Canales** (the
platforms the conversation lives on, listed), **Mención** (each time the topic appears online: a
post, a comment, a review, the base unit), **Conversación orgánica** (what people say on their own,
excluding press, SEO and paid, the noise that inflates the count without saying anything),
**Sentimiento** (the charge of a mention, read on the text and not only on the count) and
**Verbatim** (the quote, unretouched, linked to the original post).

**Reporte adds one:** *Cómo se organiza la lectura.* Defines **Corpus**, **Tópico y narrativa** (a
recurring pattern, not a loose mention), **Señal** (a pattern that holds over time, the difference
between a passing spike and real change), **Periodo y corte** (the window, always compared against
the prior period), **Priorización** (which conversations matter and why, because repetition alone
is not enough) and **Alcance**.

**Estudio adds two.** *Los términos del estudio:* **Trigger** (what pulls: desire, fit with your
life, validation, a code in favour), **Barrier** (what stops: anxiety, cost, fear of judgement, a
category taboo), **las cuatro capas** and **doble codificación** (each expression classified twice,
push or block and which layer, because without it the actionable patterns disappear). Then *Cómo se
leyó, y hasta dónde llega:* **Corpus** stated with its real size, market, window and channels,
**Priorización**, **Permiso para actuar**, and **Hasta dónde llega**, which says out loud that the
read is directional and motivational, not a sales or market projection, that it portrays the moment
it was taken, and that the system of motives moves, so it gets re-read.

That last term is the study's honesty clause and it is not optional. A study that cannot say how
far it goes is selling a projection it did not make.

## Muestra — the study, cut short

Same spine as the study, with the back half collapsed. Keep: cover, brief, the framework slide,
the noise filter, the channels slide, the map, the top pull and the top barrier with their
anatomies, the answer, the method slide, glossary. Collapse opportunities, action plan and what to
watch into a single teaser block plus a closing slide with a concrete next step.

A sample that gives away the full action plan is not a sample.

### The noise filter slide (optional, earns its place fast)

When the corpus needed a hard de-noising pass, say so early: `.kpi` with what was heard vs. what
was reported, and a `.note` with the criterion used. It builds more trust than any volume number,
and it makes the later counts credible.

## Non-negotiables (every family)

- **Everything vs. the prior period** in a reporte. No number stands alone.
- **Consolidated, equal-height cards** on the volume/channels slide (chart and bars aligned).
- **Verbatims are real**, pulled from the corpus, with a link to the post and a visible source
  (platform logo + date). Never invented.
- **No black cards.** Interpretation lives in a light `.note` (teal-soft) or a `.slide.dark`
  full-bleed statement, not a black callout box.
- **Soft bar gradients** (`#0d8a8a→#37b0ad`, coral `#d6492f→#e8735c`), never harsh cyan.
- **Icons everywhere**, and real (see `ICONS.md`).
- **`data-label` is navigation metadata**, never rendered copy.
- **Footer left is `noisia · social intelligence architects`**, footer right is `NN / TOTAL`.
- **Render every slide at 1920×1080 and look at it** before calling it done.
