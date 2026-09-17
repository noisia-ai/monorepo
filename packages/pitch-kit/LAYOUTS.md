# Layouts — the canonical deck shapes

> Proven slide sequences and components, extracted from the shipped decks. Build new work from
> these instead of inventing structure. The contract that governs all of them is `CANON.md`;
> components live in `engine/deck-components.css`; icons in `ICONS.md`; words in `COPY_RULES.md`;
> charts in `CHARTS.md`.

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

## The height budget

Slide capacity is not a mystery to be discovered by rendering. These are the numbers, so a title
that will not fit on one line gets caught while writing rather than after export.

| | |
|---|---|
| Canvas | 1920 × 1080 |
| `.frame` usable width | 1700px, x=110 to x=1810 |
| `.mid` usable height | about 745px, y ≈ 180 to y ≈ 925 |
| Eyebrow | 34px |
| `.hl` at 54px, one line | 58px, plus 22 margin |
| Each extra title line | 58px |
| `.note`, two lines | about 90px |
| `.foot`, one line | 24px |
| `.mtx` row | about 50px |

**`.mid` centres vertically, so overflow is symmetric.** When content exceeds it, the slide breaks
at the top *and* the bottom at once: the eyebrow lands on the logo while the footnote lands on the
footer. `builders/qa-render.py` checks both bands for exactly this reason. Seeing only one of the
two and fixing the bottom leaves the top broken.

## Backgrounds: one composition per slide

The engine paints the same cyan blob in the same corner on every slide. Over fourteen slides that
reads as a template. `builders/gen-backgrounds.py` writes one composition per slide, each in a
different corner, at alphas low enough that the background accompanies the content instead of
competing with it.

```bash
python3 builders/gen-backgrounds.py <deck-dir> --slides 14 --dark 12
```

The slide then carries `atmos plain`, to switch the engine's own blob off, and its background
behind the frame:

```html
<section class="slide"><div class="atmos plain"></div>
  <img class="bg" src="assets/bg-04.png" alt=""><div class="frame">…</div></section>
```

Two slides earn an exception and get a quieter background written by hand: the ones where the
content is the protagonist, a journey map or a friction matrix. There the background drops to a
single blob at very low alpha, or disappears.

Grain, if the deck uses it, is **baked into the asset**. Never computed in the browser: the print
renderer rasterises an SVG filter and it comes out as cloud, not grain, and it doubled one PDF.

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

### Variant: full-bleed background instead of the illustration

A cover can carry a full-canvas image instead of the illustration bleeding right. It is a different
composition and it comes with four rules:

1. **The illustration comes out.** Two full-bleed elements fight each other. Pick one.
2. **The slide still carries `atmos plain`**, for the same reason as the illustrated cover: the
   engine's cyan blob over artwork reads as a wash.
3. **A dark image makes it a dark cover.** Switch the section to `slide dark` and invert the type.
4. **Copy over colour needs a scrim, and the scrim gets measured.** Sample the luminance behind each
   line of text and set the scrim from that, not by eye. If a footer sits over a blob, lift that one
   footer rather than the whole deck's edge opacity.

Grain belongs to the asset, not to the browser. See `ICONS.md`.

## Reporte — canonical sequence (~10 slides)

| # | Slide | Components |
|---|---|---|
| 1 | Cover | `slides/cover-study` — cover spec above (eyebrow = subject, not "subcategory") |
| 2 | The month at a glance | `.kpi` ×4 + `.irow` reads (continuity vs. prior). **The big figure is the period's absolute value; the delta rides beside it as a chip.** A delta on its own says nothing and invites the reader to mistake the study's corpus for the month's volume |
| 3 | Share of voice + channels | two equal-height `.vcard`s: `.bars` (SoV by brand) ‖ `.bars` (channels) |
| 4 | Sentiment by brand | `.sbrow`/`.split` (neg/pos among those with an opinion) + `.irow` "what's behind it" |
| 5 | What it argues about | `.tbl` topics (theme · lean `.tag` · loudest-for · `.mini` share · trend) |
| 6 | Head-to-head | `.hh` cards ×4 (match-up + claim + one verbatim). **Every brand shows its denominator**: the comparable metric on top and the universe it comes from underneath, with `.hd`. A competitor at zero without its base reads as a brand that does not exist, when the truth may be that it has conversation and none of it is about the thing being compared. **R2 only**: a single-brand report (R1) drops this slide and lands at 9 |
| 7 | Evidence | `.vq` verbatims, real + link + source chip, split friction / pull |
| 8 | The read | `.slide.dark` statement + `.note` "and then what → study" |
| 9–10 | Glossary ×2 | `.gloss`/`.gterm` + channel `.chip`s |

## Estudio (Triggers & Barriers) — canonical sequence (14–18 slides)

| # | Slide | Components |
|---|---|---|
| 1 | Cover | `slides/cover-study` — cover spec above; research question as the subject |
| 2 | Brief | `.idx` index cards. The cover already asked the question, so **this slide says what the study delivers**, not what it asks. Repeating the research question two slides running burns the second-most expensive title in the deck |
| 3 | The four layers | `slides/tb-layers`, or `slides/tb-layers-evidence` when there are quotes to carry it. See spec below |
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

**The evidence variant.** When the corpus has quotes worth showing, `tb-layers-evidence` is the
better version of this slide: the asset runs large, the flanks carry five to nine real verbatims,
triggers over the teal blob and barriers over the coral, and the four permission cards collapse
into a one-line legend under the title. It stops explaining the framework and starts demonstrating
it. Its measurements are taken, not estimated, and they are in the fragment's header: respect them
or measure again. The asset itself does not change, only its size and what surrounds it.

**When the study uses a different frame** (a fast-moving public-affairs topic, a risk read, a
maturity model), keep the same slide *function* and swap the diagram for a 2×2 grid of framework
cards: the `.fwg` / `.fwc` components, each an `.icobox` + a `.tag` with the term + a
plain-language headline + two lines of what it means here. The rule is that the frame gets explained on its own slide, in human language, **before**
any slide uses it. Never introduce a frame and use it in the same breath.

### The method slide (#15) — traceability, client-safe

One slide, near the end, that makes the whole deck defensible. What goes on it:

- **A strip of hard facts across the top**, one cell each: period, market, original corpus,
  de-noised corpus, and the coverage of the coding (how many mentions actually got a label). The
  original and the de-noised figure side by side are what give the discard its dimension.
- Four `.irow` blocks: what was listened to, what was left out and roughly how much, how it was
  read, and what the evidence is.
- **A sources row**: each platform's mark with its own count. It is the line that lets someone
  check the mix without opening the annex.
- **A `.foot`, not a `.note`**, with the honest limit: which claims are exact and which are
  directional, and what this base cannot see at all.

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

**Estudio adds two**, and the first one is **per methodology**, not per deck. Its structure is
fixed even though its terms are not:

| Slot | What goes in it | T&B | Journey Friction Mapping |
|---|---|---|---|
| The motive | the unit of analysis: what gets named, ranked and acted on | a trigger, a barrier | a friction |
| The counted unit | what actually adds up in each cell of the map | mentions carrying that signal | mentions carrying that friction |
| The axes | the two independent codings | direction and layer | moment and friction type |
| Where it lives | the map the study uses | the four layers | the phases of the journey |
| What can move | the permission to act | brand moves psych + personal fully | mobility per friction |
| The double coding | why one pass is not enough | same sentence, both axes | same, and the axes never sum |

Six methodologies are in the catalogue, so writing this block from scratch each time is five more
repetitions of the same work. Fill the slots; do not invent the shape.

Then *Cómo se leyó, y hasta dónde llega:* **Corpus** stated with its real size, market, window and
channels, **Priorización**, what can be acted on, and **Hasta dónde llega**, which says out loud
that the read is directional, not a sales or market projection, that it portrays the moment it was
taken, and that the system moves, so it gets re-read.

That last term is the study's honesty clause and it is not optional. A study that cannot say how
far it goes is selling a projection it did not make.

## Muestra — the study, cut short

Same spine as the study, with the back half collapsed. Keep: cover, brief, the framework slide,
the noise filter, the channels slide, the map, the top pull and the top barrier with their
anatomies, the answer, the method slide, glossary. Collapse opportunities, action plan and what to
watch into a single teaser block plus a closing slide with a concrete next step.

A sample that gives away the full action plan is not a sample.

### The noise filter slide — study and sample only, never a report

When the corpus needed a hard de-noising pass, show it early: `.kpi` with what was heard vs. what
was reported, and a `.note` with the criterion. It builds more trust than any volume number.

**It does not belong in a monthly report.** A recurring client already got July's edition and will
get September's. Telling them in the August one that the underlying corpus spans twelve months
breaks the fiction of the deliverable and opens questions the edition cannot answer: why twelve
months, what was there before, why didn't I see it. In a report the de-noising is communicated as a
`.foot` on the slide where it matters, at the scale of the month. The full funnel lives in
`PROVENANCE_AND_CHANGELOG.md`, which is its place.

## Non-negotiables (every family)

- **Everything vs. the prior period** in a reporte. No number stands alone.
- **Consolidated, equal-height cards** on the volume/channels slide (chart and bars aligned).
- **Verbatims are real**, pulled from the corpus, with a link to the post and a visible source
  (platform logo + date). Never invented.
- **No black cards.** Interpretation lives in a light `.note` (teal-soft) or a `.slide.dark`
  full-bleed statement, not a black callout box.
- **The teal `.note` is for insights only.** A methodological aside in that container gives a
  footnote the visual weight of a finding. Scope notes, axis explanations and honest limits go in
  `.foot`: grey, small, italic, no fill.
- **Soft bar gradients** (`#0d8a8a→#37b0ad`, coral `#d6492f→#e8735c`), never harsh cyan.
- **Icons everywhere**, and real (see `ICONS.md`).
- **`data-label` is navigation metadata**, never rendered copy.
- **Footer left is `noisia · social intelligence architects`**, footer right is `NN / TOTAL`.
- **The closing pages are titled literally.** Glosario. Método y alcance. Alcance y límites. The
  body of the deck carries titles that state a finding; a sentence-shaped title on a reference page
  reads as filler. See `COPY_RULES.md`.
- **Render every slide at 1920×1080 and look at it** before calling it done, and **check the PDF
  itself**, not only the screen capture. Two bugs only show up there:
  - Chrome's print rasterizes `box-shadow` and `backdrop-filter` as solid grey boxes. `deck.css`
    already flattens `.glass` under `@media print`; any custom card you build outside `.glass`
    needs the same treatment, a solid fill and a border, or a full-colour block.
  - An image with `flex:1` pushes the caption or the footer off the canvas. Add `min-height:0` to
    the flex container.
