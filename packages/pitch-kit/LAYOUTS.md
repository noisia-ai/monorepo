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

## The families

`CANON.md` §3 owns the family decision. This file owns the sequences for **Reporte**, **Estudio**
and **Muestra**; the commercial family (openers, overview, offer, proposal, one-pager) is built in
native PPTX from `commercial/` and follows `commercial/COMMERCIAL.md`.

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

Every shipped client deck converged on the same cover, so it is canon now. Full-bleed illustration
on the right, copy anchored bottom-left. **Not for internal decks**: their cover is the title and
nothing else (`INTERNAL.md`).


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

### Variant: the client's mark on a market study

A study read market by market can carry the client's logo and the market's flag on the cover. The
flag is redrawn as a 44px circle in the official colours, turned a few degrees so it does not read
as an emoji; the shared flag module generates unique SVG ids per use (`CANON.md` §6). A text chip
restating "brand × topic · country" is redundant next to both marks and comes out.

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
| 4 | Hypothesis | the claim + a chart that *is* the proof (e.g. triggers & barriers rising together). When the subject is scarce, the proof is its weight: mentions per 10,000 of each brand's own conversation, which compares brands of very different size on one bar |
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

**The sequence is a ceiling, not a floor.** A study can land at twelve slides and be better for it.
The narrative order that survived review: the finding that opens the story goes **right after the
frame**, not as a late support slide; the plumbing (the de-noising detail, the corpus composition)
goes to the annex, and if two annex slides repeat each other's numbers, they merge. The three-step
corpus funnel is the exception: the study is sold by its size, so it stays in the body (see below). A slide that
arrives confusing after two clear ones is cut and its finding folded into a neighbour. When the
funnel does appear, it is drawn as a real funnel, decreasing width and centred, not as a list.

### Paid or freebie: the size and the density change

Ask it at the start; it decides the deck. Freebies (a sample, a pilot given away, a pitch study)
land at **10 to 15 slides** and stop at the diagnosis. A **paid** study, regular size, lands at
**25 to 40** on the multi-question skeleton below: the October paid studies shipped at 41, 33 and
30 slides, each with its reason in the record. "The sequence is a ceiling" is a rule for freebies
and thin bases; a paid study is measured by whether every question got its full block, not by
being short.

The bar for a paid study is the beer-and-football study (v5), **read together with its changelog**:
what makes it the standard is the feedback trail from v1 to v5, not only the final PDF.
`examples/_local/INDEX.md` marks which reference decks were paid and which were freebies, and points
to each record.

What it costs to miss this: a paid study built on that skeleton without its density came back as
"super thin, I can't send it like this": no time series, no channels, no images, nothing a media
team could use. Before writing the builder of a paid study, open **all** the reference decks, not
one.

### What a paid study carries: the floor, not the ceiling

A freebie has a ceiling; a paid study has a floor. The one that came back "super thin" had a
solid method underneath (gates, a pilot with kappa above 0.9, title asserts); what it lacked was the
surface: every finding was a claim with one bar, with no time, no channel, no image and no
consequence for whoever buys media. Its approved version added, in this order:

1. **"The answers" on slide 3**, before anything else: one row per question, an icon, the answer
   in one line and its figure. It is the slide the client forwards; whoever reads one slide reads
   that one. Then an index by chapter with page numbers computed at build time.
2. **The panorama**, before or next to the frame: the funnel (collected, unique, analysed), channel
   share and channel by month, the topics with their curve and topic by channel, and the layers by
   channel and by month with one real mention per layer. The T&B frame uses `slides/tb-layers-evidence`
   whenever there are verbatims, and in a paid study there always are.
3. **Each finding as a block of three slides:**
   - **in data:** how many mentions, the monthly peak, its subtypes, the channel;
   - **in real life:** the videos with their capture and reach, the ads with a caption, so the
     reader sees what kind of content it is (visible, not playable);
   - **in their words:** four to six quotes in an even grid. Three wide quotes with little text look
     broken; a 2 × 3 grid does not.
4. **Every brand comparison over time:** monthly lines on top and share below, for search and for
   conversation separately, the client in the accent and the rest in grey (`CHARTS.md` §11), a
   logo on every brand.
5. **Every brief question answered with a chart, a quote and its "for media" line.** With more than
   three questions, skip the sub-covers: the question goes as the slide's eyebrow ("Question 2 ·
   does seeing the result convince more than the spec sheet?") and the title is its answer; the
   chapter shows in the index. If the conversation cannot answer it, the slide says so and sends it
   to the questions to validate.
6. **The "for media" block and the questions to validate** (below), and where to act.

**T&B is one structure, not the only one.** When the brief brings its own questions or themes, those
are the chapters, each with its sub-cover in the client's language (plus a line in the market's
language), closing with what it means for the brand. In a three-market study the structure was the
client's five themes, and each chapter ran data (monthly bars, subthemes, tone) → subtheme cards →
the gallery → voices and "for the brand". Forcing the T&B frame on it would have got in the way.

**A three-slide summary ships with every paid study.** The client's strategist asked for "three or
four top line observations" the next day, every time: three things to know, the markets or
questions side by side, the main bet.

**Slide 4 of a paid study is mentions over time by channel**, with the funnel as a strip of figures
above it; that is the convention clients expect. No text-only slide outside the cover, the chapter
covers and the answer; every figure of a front or theme carries its channel cut. Before delivering,
put the render next to the paid reference and count data panels per slide, not only slides: a
first cut was rejected with an empty-ish closing trio and a slide of four loose figures.

**The descriptive variant.** When the client must not receive recommendations (a government
service was one), each chapter closes with "what this means / what to watch" instead of the
recommendation, and the end carries the dates coming up and the questions to validate by survey.
Those closings still carry data; three nearly empty closing slides were the main note of its review.

If the client's own base is small, its brand funnel goes in the deck before anyone asks, every step
visible: with the name written, language, country, people, voice, relevant. "Were there really only
26 comments?" was asked of a deck that did not show it.

**Every image says what it is in a caption**: advertiser or poster, platform, date and what it
shows. "I don't understand the context at all" was said of a slide of ads with no caption. If it
cannot be said in one line, the image does not go.

**Before writing the builder, a density table against the reference.** For each slide of each paid
reference deck, note what it carries: time series, channel cut, images, logos, quotes, implication.
The first cut is checked against that table, not against the sequence of chapters. Reading one
reference and taking its skeleton without its density is how the thin cut happened.

**The visual review measures fill, not only overflow.** A card more than a quarter empty asks for a
chart or more evidence. `qa-render.py` does not catch it, so each slide is looked at, at 1280px and
on the contact sheet.

**Titles are audited against the chart under them, not only against their number.** Three titles
of the approved version passed their assert and still said more than the slide showed: one named a
price theme the slide did not show, one called a brand the most repeated answer when another had
24 of 63.

### Search, paid media and the "for media" block

A paid study sets what people search and what brands advertise beside what people say
(`METHODOLOGY.md` §4.7). Two charts that work together: searches over the period, one colour per
brand, under a timeline of when each brand is searched most; and the same for the conversation.

It closes with a **"for media" block, two standard slides**: searches by intent with their volume;
then audiences, messages, channels and moments, each tied to a figure of the study. The test is the
client's own: "how does this help the media team?" A paid study that answers the business question
in words and gives the media team nothing to use was rejected.

### Before the sequence: the three sentences

Before choosing a single slide, the agent writes in the chat, and waits for a yes:

1. **The three sentences the client will repeat** in their next meeting, each one tied to the
   decision the study enables. Not three topics: three claims with their number.
2. **The obvious test for each** (`COPY_RULES.md` §2.9): could the client have written it before
   the study? If so, it is context and a fourth candidate takes its place.
3. **What the data does not give**, said before the deck exists, not on the method slide after.

The deck is then built from those sentences: the first one opens right after the frame, each one
gets its proof and its anatomy, and the canonical sequence orders whatever is left. The three
sentences decide the order and what leads; they do not shrink a paid study. Each one still gets its
three-slide block (see "What a paid study carries"). Two cases set
this rule side by side. A study that filled the sequence slot by slot, on a thin base, came out
correct in every rule and flat: its strongest finding sat on slide 11. A proposal built on the
client's own metric and its own org chart, one block per business unit, with its competitors and
its calendar in the questions, was the deck the team rated best. The design was the same;
what changed was that every slide answered something the client already cared about.

**Dark slides on a sensitive subject go without red.** The dark compositions of
`gen-backgrounds.py` came out reddish, and in a study about violence they read as alarm; they were
swapped for the teal gradient of the cover. Until the builder has a calm option, pick the dark
background by hand on those subjects.

### Rhythm: what made a correct deck read as machine-made

Same study. Every body slide had an eyebrow with an icon, a teal `.note` and a `.foot`, and five
of them were the same horizontal bar chart. Each slide was fine; seventeen of them read as a
template filled in. These rules are about repetition, not about density: the cure for a template
feel is varied evidence (series, channel cuts, images, quotes, logos), never fewer slides or less
content. Rules:

- **No eyebrow on body slides by default.** It goes only to carry a coined name the client will
  reuse (the name of a program or of the method, `LEARNINGS.md`), or to mark sections in a long
  deck. "What pushes", "the mirror", "anatomy of the trigger" are labels the title already says.
  The fragments in `slides/` carry an eyebrow slot: delete it unless one of those two applies.
- **The insight `.note` on at most a third of the slides**, the ones where interpretation is the
  point. On the rest the title already says the finding.
- **A `.foot` only where a number needs its base** or a reader would ask "out of what".
- **Never three slides running with the same layout.** Two bar charts in a row are fine; a third
  becomes a table, a mirror, a quote wall or a single big number.

**Channels slide framing.** Clients ask for the channel split and it earns its place, but frame it
as *where people talk and what each platform is for*, never as "share of voice de la categoría".
That phrasing reveals the sell (`COPY_RULES.md` §0). Each channel's role has to be demonstrable
with verbatims from that channel, not assigned by platform stereotype (`DATA.md` §18).

### The framework slide (#3) — the one clients remember

The slide is **titled with the method's name, in English**, in every language: `Triggers &
Barriers`. The concentric-rings diagram sits **behind** the content and carries the explanation:

- The whole geometry is the `.tbmap` component: `assets/tb-map.png` absolutely positioned,
  `width:1320px`, centered, `z-index:-1`, inside a `position:relative; height:560px` wrapper.
- Left label in `--teal` (`.tl.pull`), right label in `--coral` (`.tl.shadow`), both at
  `top:250px`, 340px wide, the right one right-aligned. In English they read `Trigger` and
  `Barrier`. In Spanish they carry the verb pair chosen for this study, with the English term in
  parentheses: `Motiva (trigger)` / `Desmotiva (barrier)`, or `Empuja (trigger)` / `Detiene
  (barrier)` when the question is why people buy or don't. See `COPY_RULES.md` §2.6.
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

**A context frame is read through the case, not defined.** When a study leans on a context
framework (VUCA and the like), one slide with its four pressures **as they show up in this
subject**, each with its own figure, beats three slides explaining what the framework is. The
reader learns the frame by seeing it hold numbers.

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

### When the study answers several questions

The skeleton that held up in a long study: cover, index, the frame, hypothesis, channels, the map,
then **one sub-cover per research question**, its analysis, and **a recommendation closing each
question**, not all of them piled at the end. Then the brand lens, mirror, kanban, the answer and
the questions to validate; the method, glossary and brands go to the annex.

**Recommendations follow one format**: the action as the headline, how, *from the study* with the
figure that backs it, *who has done it* with a real public precedent and its source, and when. In a
plan the client's team will run, add owner, indicator and risk. Only on layers a brand can move. If
there is no precedent, say so ("open ground"); if a competitor already did it, it goes in as a risk
("reads as a copy").

- **Only what a brand team can execute**: communication, content, activation, media and
  partnerships. "Make getting into the stadium easy" is not marketing's to do, and it was rejected.
- **Three good ones beat five weak ones.** Not one per theme out of obligation.
- **Research the portfolio before recommending.** Sister brands in the same group may already own
  the asset, and a competitor may own the league, the club or the venue. The recommendation moves to
  the free space ("be the beer of the banter, not of the badge").
- **A question works as the headline**, trend-report style: "How can {{BRAND}} win the
  viewing-centre night?", over action cards.

**When the brief brings hypotheses instead of questions, each hypothesis becomes a question**: with
how it is measured, its sub-cover, its analysis and its recommendation. The broad question stays as
the umbrella on the cover. That is where the multi-question structure of one paid study came from:
a broad question and four hypotheses.

**A client's own hypothesis is measured part by part.** When the client brings a brand idea, each
part gets its quantity per channel. If a part barely appears, say it with the number and show where
it does appear. The client wants to place its ideas on numbers; it already has the qualitative.

**The closing slide separates what people write from what matters to them.** Social measures what
people write; what matters is validated by survey. Three columns: the question, what social already
shows, and the concrete question for the questionnaire with its screener. It also tells the client
which parts depend on us and which on them.

**Adding a finding means re-reading the whole deck.** A new finding changes old slides: the answer,
the kanban, the index, the recommendations. In one case a single new reading improved ten existing
slides. Patching only the new slide leaves the deck arguing with itself.

### Slides that came out of a multi-market study

- **The corpus funnel.** Three cards, collected → unique → analysed, each with a proportional bar.
  Under them two equal cards: channels, and languages with a census figure for the market and its
  source. Because the study is sold by corpus size, this one is **not** annex plumbing: it goes at the
  start of the method or as its own slide (`DATA.md` §25, `CANON.md` §5.7). The de-noising detail,
  the composition of the discard, still goes to the annex.
- **Subthemes, right after the theme's data slide.** One card per subtheme with its share, a chip
  carrying the name the subtheme had on the previous slide to the right of the share, an evocative
  title with its definition for this market, a trend line, the channels and a literal quote. The
  card links to its gallery with `#N`.
- **Day of the week**: a heatmap of theme × day (`CHARTS.md`).
- **A three-slide summary across markets**: three things to know, with evidence per country; the
  markets side by side; the main bet per country.
- **The presenter script for several decks at once** is an internal HTML table, one row per slide and
  one column per deck. It reads the slide numbers from the decks so it never drifts.

### The "in the wild" gallery

Asked for by a client: tiles per theme that open 10 to 20 real pieces (TikTok, Instagram, YouTube),
ordered by engagement, mixing fans with brands, clubs and competitors. A data-backed mood board for
creatives that also serves measurement and awards entries.

1. **Candidates come from the raw exports**, emitters included: YouTube comments with `v=` (they carry
   the parent video's views), TikTok comments (the link leads to the parent video), X posts with
   `pic.x.com`, Instagram posts. Gate by country and theme, rank by views/100 + interactions + 25 ×
   comments in the corpus.
2. **Public metadata, no login**: YouTube oEmbed (title, author, `i.ytimg.com/vi/<id>/hqdefault.jpg`),
   X through its syndication endpoint, TikTok oEmbed with a browser User-Agent (it rate-limits early,
   space the calls). Instagram and Facebook give no thumbnail without login: they go as text tiles.
3. **Curation by agents**, eight per theme: real relevance, a mix of fan, brand, club and media, the
   subtheme, who posted, and one line on what it shows.
4. **Human review before publishing.** A violent meme, a political image, a post about a player's
   death and a campaign repeated across two networks came out. A gallery ships with seven pieces
   rather than with a doubtful one, and it reflects what exists: it is never padded.
5. **Thumbnails downloaded and recompressed** (640px, JPEG 82) into `assets/img/`. That is a file
   download: ask the user first, with the source and the size.
6. **The tile**: a fixed-height image with `object-fit:cover`; a pill with the network and the reach
   (hidden below 1K views or 50 interactions); a subtheme chip and a who-posted chip; a two-line
   clamp; the whole tile is an `<a target=_blank>`. Links survive Chrome's PDF, about 140 per deck.

**Quality Gate and Size Gate.** The team calls them by these names, and they apply to the gallery,
to thumbnails and to ad creatives alike:
- **Quality Gate:** the image shows what its text says, the quote is literal and verified, and the
  gallery ships with fewer pieces rather than with a doubtful one.
- **Size Gate:** reach is shown only from 1K views or 50 interactions; images at 640px, JPEG 82;
  backgrounds at 480×270 (`builders/gen-backgrounds.py`); every other asset at canvas size.

**Get TikTok thumbnails at the start of the case, not at the end.** With 20 to 45 seconds between
calls, TikTok's oEmbed still answered 429 almost every time late in a case, and in another it
answered 429 from the first call. **Plan B, first choice:** the video's public page, fetched with a
browser User-Agent, carries the cover URL and the day's views, likes, comments and shares in its
`__UNIVERSAL_DATA_FOR_REHYDRATION__` block; 24 of 24 worked with 4 seconds between calls. Next: a
capture of the page in the browser, cropped to the player area (323 × 576, JPEG 82), with the reach
taken from the export. The last resort is a text tile with the poster's literal text.

**Brand logos at the same optical size, not the same height.** At equal height a wide logo looks
bigger than a thin one and a list stops reading as a list. Trim each logo to its ink on a
transparent background and size it for equal visual area (height proportional to
`1/sqrt(aspect ratio)`), with a nudge up for thin strokes. The real logo, never the name in text.

### Composition rules from the same case

- The insight `.note` and the `.foot` sit at the bottom of the slide, and the content block is
  centred vertically; half a slide left empty reads as unfinished.
- Side-by-side cards: columns with `justify-content:space-between` and their metadata with
  `margin-top:auto`, so every card's meta lines up.
- A text that must fit one line (a channel's role) gets `white-space:nowrap` and copy short enough
  to fit. **Never an ellipsis cutting it.**
- An image has to show what its text says, or it comes out. Full proportion, never cropped to fill,
  with a caption. If there is spare space, redistribute the content, never stretch the image.
- Something qualitative that happens over time goes as a journey with the `.jm` frame: context data
  above, a curve with real data per moment, and under it each phase with its case count, a
  description and a verified quote.
- A cover asset is cut to its contour **without quantising colours**: quantising leaves rings in the
  halo. Position it by looking at the render.
- **A grid has a hierarchy.** The main card is wider and sits on `--teal-soft`; N identical cards
  weigh every point the same (`impeccable.style/slop`, identical card grids).
- **Cards with few elements get a max width and are centred.** A two-card slide never stretches its
  content edge to edge.
- **Titles stay within two lines** at the deck's scale. Shortening a title means rendering again:
  one shortened after review shipped broken, three lines over a matrix.

### Slides that came out of a state-level political study

Built with deck classes; they go to the engine if a second study needs them:
- **Thermometer by region**: cells of region × theme with an alert level and its base.
- **Zones of silence**: comments per 10,000 inhabitants (`DATA.md` §18, regions).
- **The echo**: a stacked bar of campaign, own page and media, with the stance of each segment
  (`DATA.md` §12).
- **The arrival**: a weekly curve of one emotion, each point sized by its base, the worst marked.
- **The subtheme card without a monthly curve**, when only time windows were read: three mini bars,
  one per window, instead of inventing months that were not read.

### Dense decks: `.deck-dense`

Past about thirty slides the default scale overflows. Put `class="deck-dense"` on `<deck-stage>`:
title 54 → 46px, eyebrow 21 → 18px, top and bottom padding 90 → 68 and 60px, title gap 52 → 34px.
These are the values one long deck settled on after overriding them by hand.

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
- **No gradient on anything that encodes a value**, and never an off-palette gradient. Bars and
  lines are flat colour (`CHARTS.md` §1); the soft gradients live in backgrounds only.
- **No side-tab accent border.** A thick coloured stripe on one side of a quote, card or callout is
  the first thing a reader spots as AI-made, and the user marked it rule number one. Valence goes in
  the source line or the slide's context. Before delivering, `grep -c border-left index.html` gives 0.
- **No uppercase label above a title that only restates it, and no icon tile stacked above a
  heading.** An eyebrow earns its place only by saying something the title does not, and on study
  body slides it is off by default (see "Rhythm" above). Commercial decks carry none at all.
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
